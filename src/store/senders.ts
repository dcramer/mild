import type { Sql } from './sql.ts';
import { type Standing, isSharedDomain, standingOf } from '../triage/standing.ts';
import type { Disposition } from '../triage/types.ts';
import { listLabels } from './labels.ts';
import { listRules } from './rules.ts';

/** What sift has recorded about mail from an address: how much, and what was done with it. */
export async function senderHistory(
  db: Sql,
  accountId: string,
  address: string,
): Promise<{ messagesSeen: number; pastDispositions: Partial<Record<Disposition, number>> }> {
  const { n } = (await db.get<{ n: number }>('SELECT count(*) AS n FROM messages WHERE account_id = ? AND from_address = ?', accountId, address))!;
  // The current decision for each earlier message from this sender.
  const rows = await db.all<{ disposition: Disposition; n: number }>(
    `SELECT d.disposition, count(*) AS n FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.from_address = ?
         AND d.id = (SELECT max(id) FROM decisions WHERE account_id = d.account_id AND message_id = d.message_id)
       GROUP BY d.disposition`,
    accountId,
    address,
  );
  return { messagesSeen: n, pastDispositions: Object.fromEntries(rows.map((r) => [r.disposition, r.n])) };
}

const CORRESPONDENT_TTL_MS = 7 * 86_400_000;

/** The cached answer to "has the owner written to this address", or undefined if unknown or stale. A yes never goes stale. */
export async function cachedCorrespondent(db: Sql, accountId: string, address: string, now: number = Date.now()): Promise<boolean | undefined> {
  const row = await db.get<{ user_has_written: number; checked_at: number }>(
    'SELECT user_has_written, checked_at FROM correspondents WHERE account_id = ? AND address = ?',
    accountId,
    address,
  );
  if (!row) return undefined;
  if (row.user_has_written === 1) return true;
  return now - row.checked_at < CORRESPONDENT_TTL_MS ? false : undefined;
}

export async function rememberCorrespondent(db: Sql, accountId: string, address: string, userHasWritten: boolean, now: number = Date.now()): Promise<void> {
  await db.run(
    `INSERT INTO correspondents (account_id, address, user_has_written, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (account_id, address) DO UPDATE SET user_has_written = excluded.user_has_written, checked_at = excluded.checked_at`,
    accountId,
    address,
    userHasWritten ? 1 : 0,
    now,
  );
}

/** What sift knows about a sender, or about everyone at a domain. */
export interface SenderFacts {
  messages: number;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  /** Messages in the last 30 days. */
  recent: number;
  /** For a domain: how many addresses have written from it. */
  senders: number;
  /** What their mail currently is, by label id, most first. */
  labels: { id: string; messages: number }[];
  /** Share of labelled mail that got the commonest label. Null with fewer than three labelled. */
  consistency: number | null;
  /** The owner's answers about their mail: sift right, sift wrong. */
  answers: { right: number; wrong: number };
  /** Whether the owner has written to them (for a domain: to anyone there). Null if not checked. */
  userHasWritten: boolean | null;
  standing: Standing;
  why: string;
}

const MONTH_MS = 30 * 86_400_000;

async function facts(db: Sql, accountId: string, who: { address: string } | { domain: string }, now: number): Promise<SenderFacts> {
  const column = 'address' in who ? 'from_address' : 'from_domain';
  const value = 'address' in who ? who.address : who.domain;
  const seen = (await db.get<{ n: number; first: number | null; last: number | null; recent: number; senders: number }>(
    `SELECT count(*) AS n, min(received_at) AS first, max(received_at) AS last, count(*) FILTER (WHERE received_at >= ?) AS recent, count(DISTINCT from_address) AS senders
       FROM messages WHERE account_id = ? AND ${column} = ?`,
    now - MONTH_MS,
    accountId,
    value,
  ))!;
  const labels = await db.all<SenderFacts['labels'][number]>(
    `SELECT d.label_id AS id, count(*) AS messages FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.${column} = ? AND d.label_id IS NOT NULL
         AND d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
       GROUP BY d.label_id ORDER BY messages DESC, d.label_id`,
    accountId,
    value,
  );
  const answers = (await db.get<{ right: number; wrong: number }>(
    `SELECT count(*) FILTER (WHERE f.verdict = 'right') AS right, count(*) FILTER (WHERE f.verdict = 'wrong') AS wrong FROM feedback f
       JOIN messages m ON m.account_id = f.account_id AND m.id = f.message_id
       WHERE f.account_id = ? AND m.${column} = ?`,
    accountId,
    value,
  ))!;
  const written =
    'address' in who
      ? await db.get<{ yes: number }>('SELECT user_has_written AS yes FROM correspondents WHERE account_id = ? AND address = ?', accountId, value)
      : await db.get<{ yes: number | null }>(
          `SELECT max(user_has_written) AS yes FROM correspondents WHERE account_id = ? AND address ILIKE '%@' || ?`,
          accountId,
          value,
        );
  const userHasWritten = written?.yes === undefined || written.yes === null ? null : written.yes === 1;

  // Only a rule for exactly this sender or domain that decides by itself says how the owner regards them.
  const dispositions = new Map((await listLabels(db, accountId, now)).map((l) => [l.id, l.disposition]));
  const rule = (await listRules(db, accountId)).find((r) => {
    const keys = Object.keys(r.match);
    return keys.length === 1 && r.whenLabel === undefined && r.when === undefined && ('address' in who ? r.match.from === value : r.match.fromDomain === value);
  });
  const does = rule ? (rule.disposition ?? (rule.labelId ? dispositions.get(rule.labelId) : undefined)) : undefined;
  const labelled = labels.reduce((sum, l) => sum + l.messages, 0);
  const consistency = labelled >= 3 ? (labels[0]?.messages ?? 0) / labelled : null;
  return {
    messages: seen.n,
    firstSeenAt: seen.first,
    lastSeenAt: seen.last,
    recent: seen.recent,
    senders: seen.senders,
    labels,
    consistency,
    answers,
    userHasWritten,
    ...standingOf({ userHasWritten, ruled: does === undefined || does === 'review' ? null : does, messages: seen.n, consistency }),
  };
}

export async function senderFacts(db: Sql, accountId: string, address: string, now: number = Date.now()): Promise<SenderFacts> {
  return await facts(db, accountId, { address }, now);
}

/** Null for a domain anyone can get an address at, which says nothing about its senders. */
export async function domainFacts(db: Sql, accountId: string, domain: string, now: number = Date.now()): Promise<SenderFacts | null> {
  return isSharedDomain(domain) ? null : await facts(db, accountId, { domain }, now);
}
