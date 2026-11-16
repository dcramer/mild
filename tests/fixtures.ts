import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, inject, onTestFinished } from 'vitest';
import { type DashboardOptions, createDashboardServer } from '../src/dashboard/server.ts';
import type { People } from '../src/store/people.ts';
import { PARSERS, pglite } from '../src/store/db.ts';
import type { Sql } from '../src/store/sql.ts';
import { type Store, storeOn } from '../src/store/store.ts';

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

/** The store over this test's database. Every call in one test shares the same rows. */
export async function freshStore(): Promise<Store> {
  const store = storeOn(pglite(await loaded()));
  return { ...store, close: async () => {} };
}

/** A new person's own database, with no mailbox yet. */
export async function openUserDb(store?: Store): Promise<Sql> {
  const on = store ?? (await freshStore());
  const created = await on.central.get<{ id: number }>('INSERT INTO users (owner, created_at) VALUES (0, 0) RETURNING id');
  return await on.user(created!.id);
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
export async function startDashboard(people: People, options: DashboardOptions = {}) {
  const server = createDashboardServer(people, { assetsDir: builtAssets(), now: () => 77, ...options });
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
  return { port, base: `http://127.0.0.1:${port}`, call };
}
