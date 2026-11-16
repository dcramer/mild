import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { type Builder, owned } from './own.ts';

/**
 * A database handle: Drizzle's builder, held to the handle's person (src/store/own.ts), on a connection
 * that is held to them as well (row-level security). Nothing outside `src/store/` opens one any other way.
 */
export interface Sql extends Builder {
  /** Whose rows this handle reads and writes; null for the central handle, which reads no one's. */
  readonly person: number | null;
  /**
   * All of `work` or none of it. `work` awaits nothing but `tx`: a Gmail or model call inside it would
   * hold the connection. A transaction opened inside one is part of it.
   */
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T>;
}

/** One connection, inside a transaction. */
export interface Connection {
  /** `array`: each row as its values in column order, which is how Drizzle reads them. */
  query: (text: string, params: unknown[], array?: boolean) => Promise<{ rows: unknown[] }>;
}

/** What a database driver does: run statements in one transaction on one connection. */
export interface Driver {
  transaction<T>(work: (connection: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// A call on any handle from inside a transaction would wait for that transaction to end (PGlite has one connection).
const inside = new AsyncLocalStorage<true>();

/**
 * A handle over `driver`. Every call runs in a transaction that first becomes `sift_app`, which owns
 * nothing and is held to row-level security, and, for a person, sets `sift.user` to them: the policies
 * then show and accept only their rows. With `person` null nobody's rows are visible.
 */
export function handle(driver: Driver, person: number | null): Sql {
  const begin = async ({ query }: Connection) => {
    await query('SET LOCAL ROLE sift_app', []);
    if (person !== null) await query(`SELECT set_config('sift.user', $1, true)`, [String(person)]);
  };
  const once = async <T>(work: (connection: Connection) => Promise<T>): Promise<T> => {
    if (inside.getStore()) throw new Error('This ran on the database while a transaction it is part of was open; use the transaction’s handle.');
    return await driver.transaction(async (connection) => {
      await begin(connection);
      return await inside.run(true, () => work(connection));
    });
  };
  const builder = (query: Connection['query']) =>
    owned(
      drizzle(async (text, params, method) => ({ rows: (await query(text, params, method === 'all')).rows })),
      person,
    );
  const over = (connection: Connection): Sql => {
    const tx: Sql = { person, ...builder(connection.query), transaction: (work) => work(tx) };
    return tx;
  };
  return {
    person,
    ...builder((text, params, array) => once((connection) => connection.query(text, params, array))),
    transaction: (work) => once((c) => work(over(c))),
  };
}
