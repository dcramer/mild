import type { DatabaseSync } from 'node:sqlite';
import { type Standing, isSharedDomain, standingOf } from '../triage/standing.ts';
import type { Disposition } from '../triage/types.ts';
import { listLabels } from './labels.ts';
import { listRules } from './rules.ts';

/** What sift has recorded about mail from an address: how much, and what was done with it. */
export function senderHistory(
  db: DatabaseSync,
  accountId: string,
  address: string,
): { messagesSeen: number; pastDispositions: Partial<Record<Disposition, number>> } {
  const { n } = db.prepare('SELECT count(*) AS n FROM messages WHERE account_id = ? AND from_address = ?').get(accountId, address) as { n: number };
  // The current decision for each earlier message from this sender.
  const rows = db
    .prepare(
      `SELECT d.disposition, count(*) AS n FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.from_address = ?
         AND d.id = (SELECT max(id) FROM decisions WHERE account_id = d.account_id AND message_id = d.message_id)
       GROUP BY d.disposition`,
    )
    .all(accountId, address) as unknown as { disposition: Disposition; n: number }[];
  return { messagesSeen: n, pastDispositions: Object.fromEntries(rows.map((r) => [r.disposition, r.n])) };
}

const CORRESPONDENT_TTL_MS = 7 * 86_400_000;

/** The cached answer to "has the owner written to this address", or undefined if unknown or stale. A yes never goes stale. */
export function cachedCorrespondent(db: DatabaseSync, accountId: string, address: string, now: number = Date.now()): boolean | undefined {
  const row = db.prepare('SELECT user_has_written, checked_at FROM correspondents WHERE account_id = ? AND address = ?').get(accountId, address) as
    | { user_has_written: number; checked_at: number }
    | undefined;
  if (!row) return undefined;
  if (row.user_has_written === 1) return true;
  return now - row.checked_at < CORRESPONDENT_TTL_MS ? false : undefined;
}

export function rememberCorrespondent(db: DatabaseSync, accountId: string, address: string, userHasWritten: boolean, now: number = Date.now()): void {
  db.prepare(
    `INSERT INTO correspondents (account_id, address, user_has_written, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (account_id, address) DO UPDATE SET user_has_written = excluded.user_has_written, checked_at = excluded.checked_at`,
  ).run(accountId, address, userHasWritten ? 1 : 0, now);
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

function facts(db: DatabaseSync, accountId: string, who: { address: string } | { domain: string }, now: number): SenderFacts {
  const column = 'address' in who ? 'from_address' : 'from_domain';
  const value = 'address' in who ? who.address : who.domain;
  const seen = db
    .prepare(
      `SELECT count(*) AS n, min(received_at) AS first, max(received_at) AS last, coalesce(sum(received_at >= ?), 0) AS recent, count(DISTINCT from_address) AS senders
       FROM messages WHERE account_id = ? AND ${column} = ?`,
    )
    .get(now - MONTH_MS, accountId, value) as { n: number; first: number | null; last: number | null; recent: number; senders: number };
  const labels = db
    .prepare(
      `SELECT d.label_id AS id, count(*) AS messages FROM decisions d
       JOIN messages m ON m.account_id = d.account_id AND m.id = d.message_id
       WHERE d.account_id = ? AND m.${column} = ? AND d.label_id IS NOT NULL
         AND d.id = (SELECT max(id) FROM decisions x WHERE x.account_id = d.account_id AND x.message_id = d.message_id)
       GROUP BY d.label_id ORDER BY messages DESC, d.label_id`,
    )
    .all(accountId, value) as unknown as SenderFacts['labels'];
  const answers = db
    .prepare(
      `SELECT coalesce(sum(f.verdict = 'right'), 0) AS right, coalesce(sum(f.verdict = 'wrong'), 0) AS wrong FROM feedback f
       JOIN messages m ON m.account_id = f.account_id AND m.id = f.message_id
       WHERE f.account_id = ? AND m.${column} = ?`,
    )
    .get(accountId, value) as { right: number; wrong: number };
  const written =
    'address' in who
      ? (db.prepare('SELECT user_has_written AS yes FROM correspondents WHERE account_id = ? AND address = ?').get(accountId, value) as
          | { yes: number }
          | undefined)
      : (db.prepare(`SELECT max(user_has_written) AS yes FROM correspondents WHERE account_id = ? AND address LIKE '%@' || ?`).get(accountId, value) as
          | { yes: number | null }
          | undefined);
  const userHasWritten = written?.yes === undefined || written.yes === null ? null : written.yes === 1;

  // Only a rule for exactly this sender or domain that decides by itself says how the owner regards them.
  const dispositions = new Map(listLabels(db, accountId, now).map((l) => [l.id, l.disposition]));
  const rule = listRules(db, accountId).find((r) => {
    const keys = Object.keys(r.match);
    return keys.length === 1 && r.tier !== 'usually' && r.when === undefined && ('address' in who ? r.match.from === value : r.match.fromDomain === value);
  });
  const does = rule ? (rule.disposition ?? dispositions.get(rule.labelId)) : undefined;
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

export function senderFacts(db: DatabaseSync, accountId: string, address: string, now: number = Date.now()): SenderFacts {
  return facts(db, accountId, { address }, now);
}

/** Null for a domain anyone can get an address at, which says nothing about its senders. */
export function domainFacts(db: DatabaseSync, accountId: string, domain: string, now: number = Date.now()): SenderFacts | null {
  return isSharedDomain(domain) ? null : facts(db, accountId, { domain }, now);
}
