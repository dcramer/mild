import { AsyncLocalStorage } from 'node:async_hooks';

type Value = string | number | bigint | boolean | null | Uint8Array;
/** A value for a `?`, or an object of them for `:name` parameters. */
export type Bind = Value | Record<string, Value>;

/**
 * A database handle. Nothing outside `src/store/` opens one any other way. Queries are written with `?`
 * placeholders, or `:name` ones given one object; they are sent to Postgres as `$1`, `$2`.
 */
export interface Sql {
  get<T>(sql: string, ...params: Bind[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: Bind[]): Promise<T[]>;
  /** For a statement whose rows are not wanted. Use `RETURNING` with `get` for what it made. */
  run(sql: string, ...params: Bind[]): Promise<{ changes: number }>;
  /** One or more statements with no parameters and no result. Never `BEGIN`: use `transaction`. */
  exec(sql: string): Promise<void>;
  /**
   * All of `work` or none of it. `work` awaits nothing but `tx`: a Gmail or model call inside it would
   * hold the connection. A transaction opened inside one is part of it.
   */
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T>;
}

/** One connection, inside a transaction. */
export interface Connection {
  query: (text: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[]; count: number }>;
  /** Several statements, with no parameters. */
  exec: (text: string) => Promise<void>;
}

/** What a database driver does: run statements in one transaction on one connection. */
export interface Driver {
  transaction<T>(work: (connection: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// A call on any handle from inside a transaction would wait for that transaction to end (PGlite has one connection).
const inside = new AsyncLocalStorage<true>();

const positional = new Map<string, { text: string; names: string[] }>();

/** `?`, `?N` and `:name` placeholders as `$n`, outside quoted text and `::` casts. */
export function toPostgres(sql: string): { text: string; names: string[] } {
  const known = positional.get(sql);
  if (known) return known;
  let text = '';
  const names: string[] = [];
  let n = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      text += sql.slice(i, end + 1);
      i = end;
    } else if (c === '?') {
      const numbered = /^\d+/.exec(sql.slice(i + 1))?.[0];
      text += `$${numbered ?? ++n}`;
      i += numbered?.length ?? 0;
    } else if (c === ':' && sql[i + 1] === ':') {
      text += '::';
      i++;
    } else if (c === ':' && /[a-z_]/i.test(sql[i + 1] ?? '')) {
      const name = /^[a-z_]\w*/i.exec(sql.slice(i + 1))![0];
      let at = names.indexOf(name);
      if (at === -1) at = names.push(name) - 1;
      text += `$${at + 1}`;
      i += name.length;
    } else text += c;
  }
  const result = { text, names };
  positional.set(sql, result);
  return result;
}

const values = (sql: string, params: Bind[]): { text: string; args: unknown[] } => {
  const { text, names } = toPostgres(sql);
  if (names.length === 0) return { text, args: params };
  const named = params[0] as Record<string, Value>;
  return { text, args: names.map((name) => named[name]) };
};

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
  const over = ({ query, exec }: Connection): Sql => {
    const tx: Sql = {
      get: async <T>(sql: string, ...params: Bind[]) => {
        const { text, args } = values(sql, params);
        return (await query(text, args)).rows[0] as T | undefined;
      },
      all: async <T>(sql: string, ...params: Bind[]) => {
        const { text, args } = values(sql, params);
        return (await query(text, args)).rows as T[];
      },
      run: async (sql, ...params) => {
        const { text, args } = values(sql, params);
        return { changes: (await query(text, args)).count };
      },
      exec,
      transaction: (work) => work(tx),
    };
    return tx;
  };
  const once = async <T>(work: (tx: Sql) => Promise<T>): Promise<T> => {
    if (inside.getStore()) throw new Error('This ran on the database while a transaction it is part of was open; use the transaction’s handle.');
    return await driver.transaction(async (connection) => {
      await begin(connection);
      return await inside.run(true, () => work(over(connection)));
    });
  };
  return {
    get: (sql, ...params) => once((tx) => tx.get(sql, ...params)),
    all: (sql, ...params) => once((tx) => tx.all(sql, ...params)),
    run: (sql, ...params) => once((tx) => tx.run(sql, ...params)),
    exec: (sql) => once((tx) => tx.exec(sql)),
    transaction: once,
  };
}
