import type { DatabaseSync } from 'node:sqlite';
import { redecideWaiting } from '../../learn/redecide.ts';
import { listAccounts } from '../../store/accounts.ts';
import type { Controls } from '../controls.ts';
import type { Scope } from '../scope.ts';

/** What a route is given besides the request: the database, what the process lets the dashboard do, and the clock. */
export interface Context {
  db: DatabaseSync;
  /** Absent when the page can look but not manage. */
  controls: Controls | undefined;
  now: () => number;
}

export interface Reply {
  status: number;
  body: unknown;
}
export const ok = (body: unknown): Reply => ({ status: 200, body });
export const missing = (error: string): Reply => ({ status: 404, body: { error } });
export const malformed = (error: string): Reply => ({ status: 400, body: { error } });

/** A GET. It is given the scope of whoever asked and must show nothing outside it. */
export interface Read {
  path: string;
  run(ctx: Context, scope: Scope, query: URLSearchParams): Reply | Promise<Reply>;
}

/**
 * Whose data a write touches. An account: only someone who has that mailbox may make it. `install`: it
 * applies to everyone, so only the install's owner may. `anyone`: nothing of anybody's. Null: the body
 * names nothing that exists, which the route itself reports.
 */
export type Touches = { account: string } | 'install' | 'anyone' | null;

/**
 * A POST. `touches` is asked first, and the write is refused before `run` when the data is someone
 * else's. `run` checks the body field by field and returns the response, null for a malformed body, or
 * throws with a sentence for the user.
 */
export interface Write {
  path: string;
  touches(ctx: Context, body: Record<string, unknown>): Touches;
  run(ctx: Context, body: Record<string, unknown>, scope: Scope): unknown;
}

/** The mailbox a write names in `accountId`. */
export const named = (_ctx: Context, body: Record<string, unknown>): Touches => (typeof body['accountId'] === 'string' ? { account: body['accountId'] } : null);

/** The mailbox that owns the row a write names by `id`. */
export const ownerOf =
  (table: 'rules' | 'proposals' | 'actions') =>
  ({ db }: Context, body: Record<string, unknown>): Touches => {
    const id = body['id'];
    if (typeof id !== 'string' && typeof id !== 'number') return null;
    const row = db.prepare(`SELECT account_id FROM ${table} WHERE id = ?`).get(id) as { account_id: string } | undefined;
    return row ? { account: row.account_id } : null;
  };

export const LABEL_ID = /^[a-z0-9_-]{1,40}$/;
export const RULE_KEYS = new Set(['from', 'fromDomain', 'to', 'listId', 'subjectContains']);
export const str = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
export const decided = (value: unknown): value is 'keep' | 'archive' | 'spam' => value === 'keep' || value === 'archive' || value === 'spam';
/** What a label can be set to do. `block` is spam plus blocking the sender. */
export const outcome = (value: unknown): value is 'keep' | 'archive' | 'spam' | 'block' => decided(value) || value === 'block';
export const fromOutcome = (value: 'keep' | 'archive' | 'spam' | 'block') =>
  value === 'block' ? { disposition: 'spam' as const, block: true } : { disposition: value, block: false };

const ALLOWED_DAYS = new Set([1, 7, 30, 90]);
/** The period a read covers, from `?days=`. Null if it is not one the page offers. */
export function daysOf(query: URLSearchParams): number | null {
  const days = Number(query.get('days') ?? 7);
  return ALLOWED_DAYS.has(days) ? days : null;
}
export const BAD_DAYS = malformed('days must be 1, 7, 30 or 90');

/** After a rule or label changed: waiting suggestions they now decide differently get a new decision. No model is called. */
export async function redecide(db: DatabaseSync, now: () => number, accountId?: string): Promise<number> {
  let recorded = 0;
  for (const account of listAccounts(db)) if (accountId === undefined || account.id === accountId) recorded += await redecideWaiting(db, account.id, now());
  return recorded;
}
