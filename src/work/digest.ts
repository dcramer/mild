import { putDigest } from '../actions/digest.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import { LISTED, toRfc822, writeDigest } from '../digest/mail.ts';
import { knownZone, scheduledBefore } from '../digest/schedule.ts';
import {
  type DigestItem,
  type DigestRecord,
  type Highlight,
  digestInserted,
  digestItems,
  digestLabels,
  dropDigest,
  hasDigestItems,
  labelOfDigest,
  lastDigestEnd,
  openDigests,
  recordHighlights,
  startDigest,
} from '../store/digests.ts';
import { preferences } from '../store/preferences.ts';
import type { Sql } from '../store/sql.ts';
import { invokeAgent, reportError } from '../telemetry.ts';
import type { Highlighter } from '../prompts/digest.ts';

/**
 * How long past the hour a digest waits, so an archive Gmail confirmed just before it is in the record by then: the
 * window ends on the hour, and is closed for good once its digest is written down.
 */
const SETTLE_MS = 5 * 60_000;

/** The zone a person's day is read in: theirs, or UTC when their browser never said or this runtime does not know it. */
const zoneOf = (timeZone: string | null) => (timeZone !== null && knownZone(timeZone) ? timeZone : 'UTC');

/** A label whose digest is due: its window, from its last digest (none before its first) to the latest digest hour. */
interface Due {
  labelId: string;
  since: number | null;
  until: number;
}

/**
 * The digests due for a person at `now`, from the record alone: while Mild is on, each label that digests whose last
 * digest ended before the latest digest hour, with mail in the window since. An empty window stays open.
 */
async function due(db: Sql, now: number): Promise<{ due: Due[]; hour: number; zone: string }> {
  const { active, digestHour, timeZone } = await preferences(db);
  const zone = zoneOf(timeZone);
  if (!active) return { due: [], hour: digestHour, zone };
  const until = scheduledBefore(now - SETTLE_MS, digestHour, zone);
  const found: Due[] = [];
  for (const labelId of await digestLabels(db)) {
    const since = await lastDigestEnd(db, labelId);
    if (since !== null && since >= until) continue;
    if (await hasDigestItems(db, labelId, since ?? 0, until)) found.push({ labelId, since, until });
  }
  return { due: found, hour: digestHour, zone };
}

/** Whether a person has a digest to write or to finish putting into Gmail. Reads the record only. */
export async function digestsWanted(db: Sql, now: number): Promise<boolean> {
  if (!(await preferences(db)).active) return false;
  return (await openDigests(db)).length > 0 || (await due(db, now)).due.length > 0;
}

export interface DigestDeps {
  db: Sql;
  /** Where each digest goes: the person's primary mailbox when it is written. */
  primary: string;
  mailbox: (accountId: string) => Promise<Mailbox>;
  /** The person's model, to pick what is worth a look; without it a digest goes without. */
  highlight?: { highlight: Highlighter; model: string } | null;
  /** Mild's dashboard, linked from each digest. */
  dashboard?: string;
  now?: () => number;
  until?: number;
}

/**
 * Write each digest due for a person and put it into their primary mailbox, one per label. Safe to run again: a digest
 * is written down before the model is asked and before it goes to Gmail, and one written down but not yet in Gmail is
 * finished as it was written, never written again. Returns how many went in.
 */
export async function sendDigests(deps: DigestDeps): Promise<number> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const out = () => deps.until !== undefined && now() >= deps.until;
  const { due: ready, hour, zone } = await due(db, now());
  let sent = 0;
  for (const record of await openDigests(db)) {
    if (out()) return sent;
    if (await finish(deps, record, zone)) sent++;
  }
  for (const { labelId, since, until } of ready) {
    if (out()) return sent;
    const items = await digestItems(db, labelId, since ?? 0, until);
    if (items.length === 0) continue;
    // A label's first digest reaches back a day, or to the first of its mail if that is older.
    const from = since ?? Math.min(scheduledBefore(until - 1, hour, zone), ...items.map((i) => i.archivedAt - 1));
    const record = await startDigest(db, {
      labelId,
      accountId: deps.primary,
      since: from,
      until,
      count: items.length,
      model: deps.highlight?.model ?? null,
      now: now(),
    });
    const highlights = deps.highlight ? await pick(db, record, items, deps.highlight.highlight, zone) : [];
    if (await finish(deps, { ...record, highlights }, zone, items)) sent++;
  }
  return sent;
}

/** What the model picks as worth a look, recorded on the digest. A failure is recorded and reported, and the digest goes without. */
async function pick(db: Sql, record: DigestRecord, items: readonly DigestItem[], highlight: Highlighter, zone: string): Promise<Highlight[]> {
  const label = await labelOfDigest(db, record.labelId);
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const shown = items.slice(0, LISTED);
  const answer = await invokeAgent('digest', [db.person, record.id], { 'sift.digest': record.id }, () =>
    highlight({
      label: { name: label.name, description: label.description },
      lines: shown.map((i) => ({
        ...(i.from.name ? { fromName: i.from.name } : {}),
        fromAddress: i.from.address,
        subject: i.subject,
        received: clock.format(i.receivedAt),
      })),
    }),
  );
  const usage = answer.usage ? { usage: answer.usage } : {};
  if ('failed' in answer) {
    await recordHighlights(db, record.id, { error: answer.failed, ...usage });
    reportError(new Error(`Digest highlights failed: ${answer.failed}`));
    return [];
  }
  const highlights = answer.picks.map((p) => ({ id: shown[p.item - 1]!.messageId, why: p.why }));
  await recordHighlights(db, record.id, { highlights, ...usage });
  return highlights;
}

/**
 * Put a written digest into its mailbox. One whose mail has all been answered or put back since is dropped, unless an
 * earlier try landed in Gmail: dropped, it would no longer be known as Mild's own, and sync would read it as new mail.
 */
async function finish(deps: DigestDeps, record: DigestRecord, zone: string, listed?: readonly DigestItem[]): Promise<boolean> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const items = listed ?? (await digestItems(db, record.labelId, record.since, record.until));
  if (items.length === 0) {
    const landed = await putDigest({ db, mailbox: await deps.mailbox(record.accountId), now }, record, null);
    if (landed === null) {
      await dropDigest(db, record.id);
      return false;
    }
    await digestInserted(db, record.id, landed, now());
    return true;
  }
  const label = await labelOfDigest(db, record.labelId);
  const mail = writeDigest({
    label: { id: label.id, name: label.name, gmailLabel: label.gmailLabel },
    mailbox: record.accountId,
    since: record.since,
    until: record.until,
    entries: items.map((i) => ({ mailbox: i.accountId, id: i.messageId, from: i.from, subject: i.subject, receivedAt: i.receivedAt })),
    highlights: record.highlights ?? [],
    timeZone: zone,
    ...(deps.dashboard ? { dashboard: deps.dashboard } : {}),
  });
  const raw = toRfc822(mail, { from: record.accountId, to: record.accountId, date: now(), messageId: record.messageId });
  const gmailId = await putDigest({ db, mailbox: await deps.mailbox(record.accountId), now }, record, raw);
  await digestInserted(db, record.id, gmailId, now());
  return true;
}
