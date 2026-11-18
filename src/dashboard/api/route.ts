import { type actions, type decisions, eq, type proposals } from '../../store/query.ts';
import { z } from 'zod';
import type { Person } from '../../store/people.ts';
import type { Sql } from '../../store/sql.ts';
import { DECIDED } from '../../triage/types.ts';
import { knownZone } from '../../digest/schedule.ts';
import { text } from '../types.ts';
import { redecideWaiting } from '../../learn/redecide.ts';
import { listAccounts } from '../../store/accounts.ts';
import type { Controls } from '../controls.ts';
import type { Scope } from '../scope.ts';

/** What a route is given besides the request: the database, what the process lets the dashboard do, and the clock. */
export interface Context {
  /** The database of whoever asked. Nobody else's data is in it. */
  db: Sql;
  /** Another person's database, for a view that merges several: refused unless whoever asked may read it. */
  open: (id: number) => Promise<Sql>;
  /** Whoever asked; null with nobody signed in. */
  person: Person | null;
  /** The mailbox their session is for; null without sign-in (tests, tools). */
  signedInAs: string | null;
  /** Absent when the page can look but not manage. */
  controls: Controls | undefined;
  /** What the page may be told of an error the request goes on past: a refusal's own words, anything else (logged and reported) only that it failed. */
  said: (error: unknown) => string;
  now: () => number;
}

export type Reply<T = unknown> = { status: 200; body: T } | { status: 400 | 404; body: { error: string } };
export const ok = <T>(body: T): Reply<T> => ({ status: 200, body });
export const missing = (error: string): Reply<never> => ({ status: 404, body: { error } });

/**
 * A GET. It is given the scope of whoever asked and must show nothing outside it. `query` parses the
 * URL's parameters (each a string, or absent) and a request it refuses is answered 400; `reply` is what
 * a 200 sends, and the server parses every one through it, dropping any field it does not name.
 */
export interface Read<Q extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  path: string;
  query: Q;
  reply: R;
  run(ctx: Context, scope: Scope, query: z.output<Q>): Reply<z.input<R>> | Promise<Reply<z.input<R>>>;
}

/**
 * A GET answered with a document for a frame on the page instead of JSON: a message as its HTML. It is
 * given the scope as a read is, and sent under the frame's own policy, never the page's (`FRAME_HEADERS`
 * in server.ts). `html` is the whole document, a sentence in place of the message when it cannot be shown.
 */
export interface Frame<Q extends z.ZodType = z.ZodType> {
  path: string;
  query: Q;
  run(ctx: Context, scope: Scope, query: z.output<Q>): Promise<{ status: 200 | 404; html: string }>;
}

/**
 * Whose data a write touches. An account: only someone who has that mailbox may make it. `self`: the
 * signed-in person's own (their model and its sign-in), so anyone signed in may. `anyone`: nothing of
 * anybody's. Null: the body names
 * nothing that exists, which the route itself reports.
 */
type Touches = { account: string } | 'self' | 'anyone' | null;

/**
 * A POST. The server parses the body through `body` (a body it refuses, or one with a field it does not
 * name, is answered 400), then asks `touches`, and refuses the write before `run` when the data is someone
 * else's. `run` returns the reply, which is parsed through `reply` as a read's is; null for a body that
 * is well formed but names nothing usable; or throws with a sentence for the user.
 */
export interface Write<B extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  path: string;
  body: B;
  reply: R;
  touches(ctx: Context, body: z.output<B>): Touches | Promise<Touches>;
  run(ctx: Context, body: z.output<B>, scope: Scope): z.input<R> | null | Promise<z.input<R> | null>;
  /** The reply means the session has ended: the server clears its cookie. */
  endsSession?(reply: z.output<R>): boolean;
}

/** A read, with its query and reply typed from its schemas. */
export const read = <Q extends z.ZodType, R extends z.ZodType>(route: Read<Q, R>): Read => route;
/** A frame, with its query typed from its schema. */
export const frame = <Q extends z.ZodType>(route: Frame<Q>): Frame => route;
/** A write, with its body and reply typed from its schemas. */
export const write = <B extends z.ZodType, R extends z.ZodType>(route: Write<B, R>): Write => route;

/** The mailbox a write names in `accountId`. */
export const named = (_ctx: Context, body: { accountId: string }): Touches => ({ account: body.accountId });

/** The mailbox that owns the row a write names by `id`. */
export const ownerOf =
  (table: typeof proposals | typeof actions | typeof decisions) =>
  async ({ db }: Context, body: { id: string | number }): Promise<Touches> => {
    const [row] = await db
      .select({ accountId: table.accountId })
      .from(table)
      .where(eq(table.id, body.id as never));
    return row ? { account: row.accountId } : null;
  };

// Parts of bodies and queries. Those the page's own bodies use are in ../types.ts.
export { decided, labelId, text } from '../types.ts';
export const accountId = text();
export const id = z.int().positive();
/** What a label can be set to do. `block` is spam plus blocking the sender; `digest` is archive plus listing it once a day. */
export const outcome = z.enum([...DECIDED, 'block', 'digest']);
export const fromOutcome = (value: z.output<typeof outcome>) =>
  value === 'block'
    ? { disposition: 'spam' as const, block: true, digest: false }
    : value === 'digest'
      ? { disposition: 'archive' as const, block: false, digest: true }
      : { disposition: value, block: false, digest: false };
/** The viewer's time zone, as their browser names it. */
export const timeZone = z.string().max(64).refine(knownZone, 'must be a time zone');
/** A flag in a URL: present as `1`. */
export const flag = z.literal('1').optional();
/** The period a read covers, from `?days=`, one the page offers. */
export const days = z.enum(['1', '7', '30', '90'], { error: 'must be 1, 7, 30 or 90' }).default('7').transform(Number);
/** What most writes answer. */
export const done = z.object({ ok: z.literal(true) });

/** What a write touches, for `touches`: only the signed-in person's own data. */
export const self = () => 'self' as const;
/** A write that takes nothing. */
export const nothing = z.strictObject({});

/**
 * After a rule or label changed: waiting suggestions they now decide differently get a new decision. No model is
 * called. `learnedGone` is a rule Sift made that was just removed. Mail Sift marked for review that a rule of the
 * user's now settles has the mark taken back in Gmail and is carried out now; a mark that could not be taken back
 * is reported, and the decision stands.
 */
export async function redecide({ db, now, controls, said }: Pick<Context, 'db' | 'now' | 'controls' | 'said'>, learnedGone?: string): Promise<number> {
  let recorded = 0;
  const marks: number[] = [];
  for (const account of await listAccounts(db)) {
    const done = await redecideWaiting(db, account.id, now(), learnedGone);
    recorded += done.recorded;
    marks.push(...done.marks);
  }
  if (controls && marks.length > 0) {
    for (const mark of marks) await controls.undo(db, mark).catch(said);
    await controls.checkNow(db);
  }
  return recorded;
}
