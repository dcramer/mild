import { memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, inject, onTestFinished } from 'vitest';
import { dashboardListener } from '../src/cli/serve.ts';
import { site } from '../src/host/site.ts';
import { type DashboardOptions, createDashboard } from '../src/dashboard/server.ts';
import type { People } from '../src/store/people.ts';
import { PARSERS, pglite } from '../src/store/db.ts';
import type { Sql } from '../src/store/sql.ts';
import { type Store, storeOn } from '../src/store/store.ts';
import { connectAccount, recordSync } from '../src/store/accounts.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { addRule } from '../src/store/rules.ts';
import { rememberCorrespondent } from '../src/store/senders.ts';

/*
 * One database per test file, loaded from the image global-setup.ts migrated once for the whole run,
 * and emptied before each test. Tests in a file run one at a time, so a test sees only what it wrote.
 */
let database: Promise<PGlite> | undefined;
let tables: string | undefined;

const loaded = () =>
  (database ??= PGlite.create({ loadDataDir: new Blob([readFileSync(inject('template'))]), parsers: PARSERS }).then(async (pg) => {
    const { rows } = await pg.query<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`);
    tables = rows.map((r) => `"${r.name}"`).join(', ');
    return pg;
  }));

beforeEach(async () => {
  if (!database) return;
  await (await database).exec(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
});

/** This test's database, as the superuser: for reading what a handle wrote, past row-level security. */
export const superuser = loaded;

/** The store over this test's database. Every call in one test shares the same rows. */
export async function freshStore(): Promise<Store> {
  const store = storeOn(pglite(await loaded()));
  return { ...store, close: async () => {} };
}

type Value = string | number | bigint | boolean | null | Uint8Array;
/** A value for a `?`, or an object of them for `:name` parameters. */
export type Bind = Value | Record<string, Value>;

/** `?`, `?N` and `:name` placeholders as `$n`, outside quoted text and `::` casts. */
export function toPostgres(sql: string): { text: string; names: string[] } {
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
  return { text, names };
}

/**
 * SQL text run as `db`'s person, held to row-level security as sift's own queries are: for a test to set
 * up rows or read back what was stored. `?` placeholders, or `:name` ones given one object.
 */
export function raw(db: Sql) {
  const query = async (text: string, params: Bind[]) => {
    const { text: statement, names } = toPostgres(text);
    const args = names.length === 0 ? params : names.map((name) => (params[0] as Record<string, Bind>)[name]);
    return await (
      await loaded()
    ).transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE sift_app');
      if (db.person !== null) await tx.query(`SELECT set_config('sift.user', $1, true)`, [String(db.person)]);
      return await tx.query<Record<string, unknown>>(statement, args);
    });
  };
  return {
    get: async <T = Record<string, unknown>>(text: string, ...params: Bind[]) => (await query(text, params)).rows[0] as T | undefined,
    all: async <T = Record<string, unknown>>(text: string, ...params: Bind[]) => (await query(text, params)).rows as T[],
    run: async (text: string, ...params: Bind[]) => ({ changes: (await query(text, params)).affectedRows ?? 0 }),
  };
}

/** A new person's own database, with these mailboxes connected as they would be by signing in. */
export async function openUserDb(...accounts: string[]): Promise<Sql> {
  const store = await freshStore();
  if (accounts.length === 0) {
    const created = await raw(store.central).get<{ id: number }>('INSERT INTO users (owner, created_at) VALUES (false, 0) RETURNING id');
    return await store.user(created!.id);
  }
  return (await onePerson(...accounts)).db;
}

/** A stand-in for the built web app: `files` by path, and a page unless they give one. */
export function builtAssets(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'sift-web-'));
  mkdirSync(join(dir, 'assets'));
  for (const [path, text] of Object.entries({ 'index.html': '<!doctype html>page', ...files })) writeFileSync(join(dir, path), text);
  return dir;
}

export type Reply = { status: number; text: string; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };

/**
 * The dashboard on a free port, stopped when the test ends. `call` sends a request as the page would:
 * a write carries the page's own origin and header unless `headers` says otherwise. A string body is
 * sent as it is.
 */
export async function startDashboard(people: People, options: DashboardOptions & { assetsDir?: string; dev?: boolean } = {}) {
  const { assetsDir = builtAssets(), dev = false, ...rest } = options;
  const dashboard = createDashboard(people, { now: () => 77, ephemeral: memoryEphemeral(), ...rest });
  const server = dashboardListener(site(dashboard, assetsDir), { dev, pageDir: assetsDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => void server.close());
  const port = (server.address() as AddressInfo).port;
  const call = (method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Promise<Reply>((resolve, reject) => {
      const own = method === 'POST' ? { origin: `http://localhost:${port}`, 'content-type': 'application/json', 'x-sift': '1' } : {};
      const req = request({ port, path, method, headers: { host: `localhost:${port}`, ...own, ...headers } }, (res) => {
        let text = '';
        res.on('data', (chunk) => (text += String(chunk)));
        res.on('end', () => {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(text) as Record<string, unknown>;
          } catch {
            parsed = { text };
          }
          resolve({ status: res.statusCode ?? 0, text, body: parsed, headers: res.headers });
        });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
    });
  return { port, base: `http://127.0.0.1:${port}`, call, handle: dashboard.handle };
}

/** A store whose one person, the owner, has `accounts`; and that person's own database. */
export async function onePerson(...accounts: string[]): Promise<{ store: Store; db: Sql }> {
  const store = await freshStore();
  let user: number | undefined;
  for (const account of accounts) user = await connectAccount(store, account, '1', 0, user);
  return { store, db: await store.user(user ?? 1) };
}

/**
 * A row in every table of a person's data that a mailbox can have one in, for `account` (connected, in
 * `db`): what deleting a mailbox or a person must take with it. Its message is `m-<account>`.
 */
export async function recordEverything(db: Sql, account: string): Promise<void> {
  const message = `m-${account}`;
  await recordSync(
    db,
    account,
    [
      {
        accountId: account,
        messageId: message,
        threadId: 't1',
        from: { address: 'news@example.com', domain: 'example.com' },
        to: [],
        cc: [],
        subject: 'Weekly digest',
        labelIds: ['INBOX'],
        headers: {},
        receivedAt: 0,
      },
    ],
    '2',
    0,
  );
  const decision = await recordDecision(db, account, message, {
    disposition: 'archive',
    subscription: 'preserve',
    stage: 'model',
    labelId: 'newsletter',
    reason: 'r',
  });
  const rule = await addRule(db, account, { match: { from: 'news@example.com' }, whenLabel: 'newsletter' }, 'user', 0);
  await rememberCorrespondent(db, account, 'news@example.com', true, 0);
  const { id: run } = (await raw(db).get<{ id: number }>(
    `INSERT INTO eval_runs (account_id, started_at, status, model, prompt_hash, labels_hash, labels, few_shot, total)
     VALUES (?, 0, 'done', 'p/m', 'h', 'h', '[]', false, 1) RETURNING id`,
    account,
  ))!;
  for (const [statement, ...params] of [
    [`INSERT INTO credentials (kind, key, value, updated_at) VALUES ('gmail', ?, 'x', 0)`, account],
    [
      `INSERT INTO actions (account_id, message_id, type, payload, original_labels, status, created_at, decision_id) VALUES (?, ?, 'archive', '{}', '[]', 'done', 0, ?)`,
      account,
      message,
      decision,
    ],
    [
      `INSERT INTO proposals (account_id, kind, match, label_id, agreed, created_at) VALUES (?, 'rule', '{"from": "a@example.com"}', 'newsletter', 5, 0)`,
      account,
    ],
    [
      `INSERT INTO proposals (account_id, kind, match, label_id, rule_id, agreed, created_at) VALUES (?, 'always', '{"from": "news@example.com"}', 'newsletter', ?, 10, 0)`,
      account,
      rule,
    ],
    [
      `INSERT INTO feedback (account_id, decision_id, verdict, disposition, label_id, via, created_at) VALUES (?, ?, 'right', 'archive', 'newsletter', 'dashboard', 0)`,
      account,
      decision,
    ],
    [`INSERT INTO examples (account_id, message_id, disposition, label_id, marked_at) VALUES (?, ?, 'archive', 'newsletter', 0)`, account, message],
    [`INSERT INTO suggestion_bodies (account_id, message_id, body_text, fetched_at) VALUES (?, ?, 'Hello.', 0)`, account, message],
    [`INSERT INTO model_runs (account_id, message_id, model, started_at, outcome, error) VALUES (?, ?, 'p/m', 0, 'failed', 'e')`, account, message],
    [
      `INSERT INTO eval_results (run_id, message_id, expected, got, duration_ms, shots, sender_shots) VALUES (?, ?, 'newsletter', 'newsletter', 1, 0, 0)`,
      run,
      message,
    ],
  ] as [string, ...(string | number)[]][])
    await raw(db).run(statement, ...params);
}

/** How many rows each table holds, by `column`'s value, for every table that has the column; read past row-level security. */
export async function rowsBy(column: 'user_id' | 'account_id'): Promise<Record<string, Record<string, number>>> {
  const pg = await loaded();
  const { rows: tables } = await pg.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = $1)
     ORDER BY 1`,
    [column],
  );
  return Object.fromEntries(
    await Promise.all(
      tables.map(async ({ name }) => {
        const { rows } = await pg.query<{ key: string; n: number }>(`SELECT ${column}::text AS key, count(*)::int AS n FROM "${name}" GROUP BY 1 ORDER BY 1`);
        return [name, Object.fromEntries(rows.map((r) => [r.key, r.n]))] as const;
      }),
    ),
  );
}
