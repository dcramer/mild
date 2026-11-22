import type { Mailbox } from '../actions/mailbox.ts';
import type { GmailApi } from '../gmail/api.ts';
import { toFacts } from '../gmail/sync.ts';
import { type Account, recordFromInbox } from '../store/accounts.ts';
import { currentDecision } from '../store/decisions.ts';
import { isOwnDigest } from '../store/digests.ts';
import { type InboxRun, addListed, advanceInboxRun, goingInboxRun, isGoing, stopInboxRuns } from '../store/inbox.ts';
import { queuedMessage, recordedInbox } from '../store/messages.ts';
import { copied } from '../store/copies.ts';
import type { Sql } from '../store/sql.ts';
import { applyTo, inboxQuery, rulesWith } from './apply.ts';
import { type Decided, type TriageDeps, type TriageReport, deciderFor, emptyReport } from './triage.ts';

/**
 * The most messages one piece of work goes through: about what four model calls at a time get through in a
 * call's time limit on Vercel, and a bound on what one piece can spend.
 */
const SLICE = 250;
/** Messages at once: model calls, or Gmail reads when applying a rule. One at a time, a few thousand would take hours. */
const AT_ONCE = 4;

type Deps = TriageDeps & { api: Pick<GmailApi, 'searchInbox' | 'getMetadata'> };
type Went = { from: number; to: number; of: number };

/** List what the run goes through, a page of the search at a time, until it is all listed or time is up. */
async function listRun(db: Sql, api: Pick<GmailApi, 'searchInbox'>, run: InboxRun, query: string, out: () => boolean): Promise<InboxRun> {
  while (!run.listed && !out()) {
    const page = await api.searchInbox(query, run.pageToken ?? undefined);
    run = await addListed(db, run, page.ids, page.nextPageToken ?? null);
  }
  return run;
}

/**
 * Go through the next `SLICE` of a listed run, `AT_ONCE` at a time, starting nothing after `out`. `each` says
 * whether it held: the rest of its batch and the slice wait for the next tick, in order.
 */
async function goThroughSlice(
  db: Sql,
  run: InboxRun,
  now: () => number,
  out: () => boolean,
  each: (messageId: string, slot: number) => Promise<boolean>,
): Promise<Went> {
  const end = Math.min(run.messages.length, run.next + SLICE);
  let next = run.next;
  // An empty inbox is finished at once.
  if (run.messages.length === 0) await advanceInboxRun(db, run, 0, now());
  while (next < end && !out()) {
    // Stopped from the page meanwhile.
    if (next > run.next && !(await isGoing(db, run.id))) break;
    const batch = run.messages.slice(next, Math.min(end, next + AT_ONCE));
    const held = (await Promise.all(batch.map((id, i) => each(id, i)))).indexOf(true);
    next += held === -1 ? batch.length : held;
    await advanceInboxRun(db, run, next, now());
    if (held !== -1) break;
  }
  return { from: run.next, to: next, of: run.messages.length };
}

/**
 * Go on with an inbox run: list what is in the inbox, then decide the next `SLICE` messages as if each had
 * just arrived, `AT_ONCE` at a time, starting nothing after `until`. A message the user answered, one waiting
 * to be carried out, and one decided since the run began are left as they are. Null when the run is no longer going.
 */
export async function continueInboxRun(deps: Deps, account: Account, runId: number): Promise<(Went & { report: TriageReport }) | null> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const out = () => deps.until !== undefined && now() >= deps.until;
  let run = await goingInboxRun(db, runId);
  if (!run) return null;
  // Once Inbox holds the whole mailbox, the record says what is in the inbox and Gmail is not asked.
  if (!run.listed && (await copied(db, account.id))) run = await addListed(db, run, await recordedInbox(db, account.id, run.most), null);
  run = await listRun(db, deps.api, run, '', out);
  if (!run.listed) return { from: run.next, to: run.next, of: run.messages.length, report: emptyReport() };
  const listed = run;

  const report = emptyReport();
  const deciders = await Promise.all(Array.from({ length: AT_ONCE }, () => deciderFor(deps, account, report)));
  // The provider is down: what it was not asked about is asked at the next tick.
  const went = await goThroughSlice(db, listed, now, out, async (id, slot) => (await goThrough(deps, deciders[slot]!, listed, id)) === 'held');
  await Promise.all(deciders.map((d) => d.done()));
  return { ...went, report };
}

/**
 * Go on applying a rule to the inbox: list the mail a search for it finds, then apply it to the next `SLICE`,
 * starting nothing after `until`. A rule removed meanwhile ends the run. Null when the run is no longer going.
 */
export async function continueRuleRun(
  deps: { db: Sql; api: Pick<GmailApi, 'searchInbox' | 'getMetadata'>; mailbox: Mailbox; until?: number; now?: () => number },
  runId: number,
): Promise<Went | null> {
  const { db, api, mailbox } = deps;
  const now = deps.now ?? Date.now;
  const out = () => deps.until !== undefined && now() >= deps.until;
  let run = await goingInboxRun(db, runId);
  if (!run?.ruleId) return null;
  const given = await rulesWith(db, run.accountId, run.ruleId);
  if (!given) {
    await stopInboxRuns(db, run.ruleId, now());
    return null;
  }
  run = await listRun(db, api, run, inboxQuery(given.rule.match), out);
  if (!run.listed) return { from: run.next, to: run.next, of: run.messages.length };
  return await goThroughSlice(db, run, now, out, async (id) => (await applyTo(db, { api, mailbox }, given, id, now), false));
}

/** One message of a run, decided again unless it is left as it is. */
async function goThrough(deps: Deps, decider: Awaited<ReturnType<typeof deciderFor>>, run: InboxRun, messageId: string): Promise<Decided | 'left'> {
  const { db } = deps;
  const prior = await currentDecision(db, run.accountId, messageId);
  if (prior && (prior.answered || prior.decidedAt >= run.startedAt || (prior.carryOut && prior.outcome === null))) return 'left';
  let listed = await queuedMessage(db, run.accountId, messageId);
  if (!listed) {
    const raw = await deps.api.getMetadata(messageId);
    const facts = raw ? toFacts(run.accountId, raw) : null;
    // Gone, or out of the inbox since the run listed it, or a digest Mild put there.
    if (!facts?.labelIds.includes('INBOX') || (await isOwnDigest(db, facts.headers))) return 'left';
    await recordFromInbox(db, run.accountId, [facts], !run.acts, (deps.now ?? Date.now)());
    listed = await queuedMessage(db, run.accountId, messageId);
    if (!listed) return 'left';
  }
  // The run's own word on whether to act: Mild was on at the press, and (through `deps.mailbox`) is still on.
  return await decider.decide(
    { ...listed, suggestOnly: !run.acts },
    prior ? { decision: prior.decision, carriedOut: prior.carryOut && prior.outcome === 'done' } : undefined,
  );
}
