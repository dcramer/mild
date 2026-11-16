import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

/** A value for a `?`, or an object of them for `:name` parameters. */
export type Bind = SQLInputValue | Record<string, SQLInputValue>;

/**
 * A database. Every call is async so that one which is not in this process can stand behind it; over
 * `node:sqlite` each is answered at once. Nothing outside `src/store/` opens a database any other way.
 */
export interface Sql {
  get<T>(sql: string, ...params: Bind[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: Bind[]): Promise<T[]>;
  run(sql: string, ...params: Bind[]): Promise<{ changes: number; lastInsertRowid: number }>;
  /** One or more statements with no parameters and no result. Never `BEGIN` or `SAVEPOINT`: use `transaction`. */
  exec(sql: string): Promise<void>;
  /**
   * All of `work` or none of it. Nothing else runs on this database until it ends, so `work` awaits
   * nothing but `tx`: a Gmail or model call inside it would hold every other caller up. A transaction
   * opened inside one is part of it.
   */
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T>;
}

export type Database = Sql & { close(): void };

/** `node:sqlite` behind `Sql`. Statements are prepared once per text. */
export function sqlite(db: DatabaseSync): Database {
  const statements = new Map<string, StatementSync>();
  const prepared = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) statements.set(sql, (statement = db.prepare(sql)));
    return statement;
  };
  const call = {
    get: <T>(sql: string, params: Bind[]) => prepared(sql).get(...(params as SQLInputValue[])) as T | undefined,
    all: <T>(sql: string, params: Bind[]) => prepared(sql).all(...(params as SQLInputValue[])) as T[],
    run: (sql: string, params: Bind[]) => {
      const result = prepared(sql).run(...(params as SQLInputValue[]));
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    },
  };

  // The connection is shared, so while a transaction is open everything else waits for it to end.
  let open: Promise<void> | null = null;
  const inside = new AsyncLocalStorage<true>();
  // `work` runs in the same tick as the check that nothing is open, so a transaction cannot start in between.
  const when = async <T>(work: () => T): Promise<Awaited<T>> => {
    for (let wait = open; wait; wait = open) {
      if (inside.getStore()) throw new Error('This ran on the database while a transaction it is part of was open; use the transaction’s handle.');
      await wait;
    }
    return await work();
  };

  const tx: Sql = {
    get: async (sql, ...params) => call.get(sql, params),
    all: async (sql, ...params) => call.all(sql, params),
    run: async (sql, ...params) => call.run(sql, params),
    exec: async (sql) => db.exec(sql),
    transaction: (work) => work(tx),
  };

  return {
    close: () => db.close(),
    get: (sql, ...params) => when(() => call.get(sql, params)),
    all: (sql, ...params) => when(() => call.all(sql, params)),
    run: (sql, ...params) => when(() => call.run(sql, params)),
    exec: (sql) => when(() => db.exec(sql)),
    transaction: (work) =>
      when(async () => {
        let release = () => {};
        open = new Promise((resolve) => (release = resolve));
        db.exec('BEGIN');
        try {
          const result = await inside.run(true, () => work(tx));
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        } finally {
          open = null;
          release();
        }
      }),
  };
}
