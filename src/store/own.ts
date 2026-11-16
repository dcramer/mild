/**
 * The query builder a handle gives out, held to one person in sift's own code, so that isolation does
 * not rest on row-level security alone. Every person's table a query reads, joins, changes or deletes
 * from gets `user_id = <person>` added; an insert has the person's id put on each row; nothing may set
 * `user_id`. The handle with nobody behind it (`central`) may not touch a person's table at all.
 */
import { DrizzleQueryError, type SQL, and, eq, is, sql as drizzleSql } from 'drizzle-orm';
import { type PgColumn, PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import type { PgRemoteDatabase } from 'drizzle-orm/pg-proxy';
import * as schema from './schema.ts';

/** The tables that hold one person's data: those under row-level security. */
const PERSON = new Set(
  Object.values(schema as Record<string, unknown>)
    .filter((t): t is PgTable => is(t, PgTable) && getTableConfig(t).enableRLS)
    .map((t) => getTableConfig(t).name),
);

// An alias answers to its own name; this is the table's.
const ORIGINAL = Symbol.for('drizzle:OriginalName');
const nameOf = (table: PgTable): string => (table as unknown as Record<symbol, string>)[ORIGINAL]!;

/** Whether `source` (a table or an alias of one) holds one person's data. */
const isPersonTable = (source: unknown): source is PgTable => is(source, PgTable) && PERSON.has(nameOf(source));

export type Builder = Pick<PgRemoteDatabase, 'select' | 'selectDistinct' | 'insert' | 'update' | 'delete'>;

type Where = SQL | undefined | ((fields: never) => SQL | undefined);
type Any = Record<PropertyKey, unknown> & ((...args: unknown[]) => unknown);

/**
 * The person's condition on `source`, or nothing for what holds no one's data (a subquery built by an
 * owned builder is already held to them). `person` null: refused.
 */
function condition(source: unknown, person: number | null): SQL | undefined {
  if (!is(source, PgTable)) return undefined;
  const name = nameOf(source);
  const columns = source as unknown as Record<string, PgColumn>;
  if (PERSON.has(name)) {
    if (person === null) throw new Error(`The central handle sees no one's data; ${name} is a person's. Open that person's handle.`);
    return eq(columns['userId']!, person);
  }
  if (person === null) return undefined;
  // What applies to the whole install reads the same for everyone; a person sees only their own mailboxes and self.
  if (name === 'accounts') return eq(columns['userId']!, person);
  if (name === 'users') return eq(columns['id']!, person);
  return undefined;
}

/**
 * Drizzle reports a failed statement as one error whose message carries the statement and every value
 * bound to it, which can be a message's text; the database's own error, its cause, says what failed
 * without them.
 */
const failed = (error: unknown) => (error instanceof DrizzleQueryError && error.cause ? error.cause : error);
const settled = (start: Any, receiver: unknown) => (ok?: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
  (start.call(receiver) as Promise<unknown>)
    .catch((error: unknown) => {
      throw failed(error);
    })
    .then(ok, fail);

const JOINS = new Set(['leftJoin', 'innerJoin']);
const REFUSED = new Set(['rightJoin', 'fullJoin', 'crossJoin', 'leftJoinLateral', 'innerJoinLateral', 'crossJoinLateral']);

/**
 * `query` with `base` kept on its where, and every table it joins held to `person` in the join. Some of
 * Drizzle's builder methods are bound to the builder itself and return it rather than the proxy, so
 * whatever returns the builder hands back the proxy instead: otherwise a later `.where` would replace `base`.
 */
function held<T extends object>(query: T, base: SQL | undefined, person: number | null): T {
  return new Proxy(query, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      if (prop === 'constructor') return value;
      const method = value as Any;
      const call = (...args: unknown[]) => {
        const result = method.apply(receiver, args);
        return result === target ? receiver : result;
      };
      if (prop === 'then') return settled(method, receiver);
      if (prop === 'where') return (where: Where) => call(typeof where === 'function' ? (fields: never) => and(base, where(fields)) : and(base, where));
      if (JOINS.has(prop))
        return (table: unknown, on: SQL | ((...a: never[]) => SQL)) => {
          const own = condition(table, person);
          return call(table, typeof on === 'function' ? (...a: never[]) => and(on(...a), own) : and(on, own));
        };
      if (REFUSED.has(prop))
        return () => {
          throw new Error(`${prop} is not held to one person; write it as a left or inner join.`);
        };
      return call;
    },
  });
}

/** Where the handle holds rows to a person, only it says whose they are. */
function noUserId(values: unknown, name: string, base: SQL | undefined): void {
  if (!base) return;
  for (const row of Array.isArray(values) ? values : [values])
    if (row && typeof row === 'object' && 'userId' in row) throw new Error(`${name}: user_id is the handle's to set, never the caller's.`);
}

/** `db`'s builder, held to `person`. */
export function owned(db: PgRemoteDatabase, person: number | null): Builder {
  const select =
    (start: 'select' | 'selectDistinct') =>
    (...args: unknown[]) => {
      const builder = (db[start] as Any).apply(db, args) as { from: (source: unknown) => { where: (w: SQL) => object } };
      return new Proxy(builder, {
        get(target, prop) {
          if (prop !== 'from') return Reflect.get(target, prop, target);
          return (source: unknown) => {
            const base = condition(source, person);
            const query = target.from(source);
            return held(base ? query.where(base) : query, base, person);
          };
        },
      });
    };
  return {
    select: select('select') as Builder['select'],
    selectDistinct: select('selectDistinct') as Builder['selectDistinct'],
    insert: ((table: PgTable) => {
      const base = condition(table, person);
      const builder = db.insert(table);
      return new Proxy(builder, {
        get(target, prop) {
          if (prop === 'select')
            return () => {
              throw new Error('Insert from a select is not held to one person; select the rows, then insert them.');
            };
          if (prop !== 'values') return Reflect.get(target, prop, target);
          return (values: Record<string, unknown> | Record<string, unknown>[]) => {
            noUserId(values, nameOf(table), base);
            const mine = (row: Record<string, unknown>) => (base ? { ...row, userId: person } : row);
            const insert = target.values(Array.isArray(values) ? values.map(mine) : mine(values));
            return new Proxy(insert, {
              get(inner, method, receiver) {
                const value = Reflect.get(inner, method, receiver) as unknown;
                if (typeof value !== 'function' || method === 'constructor') return value;
                if (method === 'then') return settled(value as Any, receiver);
                const call = (...args: unknown[]) => {
                  const result = (value as Any).apply(receiver, args);
                  return result === inner ? receiver : result;
                };
                if (method !== 'onConflictDoUpdate') return call;
                return (config: { set: unknown; setWhere?: SQL }) => {
                  noUserId(config.set, nameOf(table), base);
                  // A key without user_id could collide with someone else's row: never update theirs.
                  return call({ ...config, setWhere: and(config.setWhere, base) });
                };
              },
            });
          };
        },
      });
    }) as Builder['insert'],
    update: ((table: PgTable) => {
      const base = condition(table, person);
      const builder = db.update(table);
      return new Proxy(builder, {
        get(target, prop) {
          if (prop !== 'set') return Reflect.get(target, prop, target);
          return (values: Record<string, unknown>) => {
            noUserId(values, nameOf(table), base);
            const update = target.set(values);
            return held(base ? update.where(base) : update, base, person);
          };
        },
      });
    }) as Builder['update'],
    delete: ((table: PgTable) => {
      const base = condition(table, person);
      const query = db.delete(table);
      return held(base ? query.where(base) : query, base, person);
    }) as Builder['delete'],
  };
}

/**
 * Drizzle's `sql`, refusing a person's table written into it: a table named in raw SQL would not be
 * held to anyone. Select from an owned builder and use that as the subquery instead.
 */
export const sql: typeof drizzleSql = Object.assign((strings: TemplateStringsArray, ...params: unknown[]) => {
  for (const param of params) if (isPersonTable(param)) throw new Error(`${nameOf(param)} written into sql\`\` is not held to one person.`);
  return drizzleSql(strings, ...(params as never[]));
}, drizzleSql);
