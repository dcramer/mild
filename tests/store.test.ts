import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/store/schema.ts';
import { connectAccount } from '../src/store/accounts.ts';
import { openStore, openUserDb } from '../src/store/store.ts';

const MIGRATIONS = new URL('../src/store/migrations/', import.meta.url);
const scratch = () => mkdtempSync(join(tmpdir(), 'sift-db-'));

describe('migrations', () => {
  it('have been generated for everything in the schema', async () => {
    const snapshots = readdirSync(new URL('meta/', MIGRATIONS))
      .filter((f) => f.endsWith('_snapshot.json'))
      .toSorted();
    const last = JSON.parse(readFileSync(new URL(`meta/${snapshots.at(-1)}`, MIGRATIONS), 'utf8')) as Parameters<typeof generateMigration>[0];
    expect(await generateMigration(last, generateDrizzleJson(schema, last.id)), 'run pnpm db:generate').toEqual([]);
  });

  it('enforce what the schema says', async () => {
    const db = await openUserDb();
    await db.run('INSERT INTO mailboxes (id, created_at) VALUES (?, ?)', 'acct', 0);
    const insert = (account: string, id: string, disposition: string) =>
      db.run(
        `INSERT INTO labels (account_id, id, name, description, disposition, gmail_label, position, updated_at) VALUES (?, ?, 'N', '', ?, 'sift/n', 0, 0)`,
        account,
        id,
        disposition,
      );
    await insert('acct', 'n', 'archive');
    await expect(insert('acct', 'x', 'delete')).rejects.toThrow();
    await expect(insert('missing', 'y', 'keep')).rejects.toThrow();
  });

  it('keep the database where they were applied, and refuse one a newer sift has migrated', async () => {
    const paths = { databaseDir: scratch() };
    const first = await openStore(paths);
    await connectAccount(first, 'me@example.org', '1', 0);
    await first.close();
    const again = await openStore(paths);
    expect(await again.central.all('SELECT id FROM accounts')).toEqual([{ id: 'me@example.org' }]);
    await again.close();

    const raw = new PGlite(paths.databaseDir);
    await raw.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('from-the-future', $1)`, [Date.UTC(2999, 0)]);
    await raw.close();
    await expect(openStore(paths)).rejects.toThrow('last opened by a newer sift');
  });
});

describe("a person's data", () => {
  it('is in tables that hold every query to row-level security, the owner included', async () => {
    const { central } = await openStore(':memory:');
    const tables = await central.all<{ name: string; enabled: boolean; forced: boolean; policies: number; person: boolean }>(
      `SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
              EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id') AS person
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('users', 'accounts')`,
    );
    expect(tables.length).toBeGreaterThan(10);
    for (const table of tables) expect(table, table.name).toMatchObject({ enabled: true, forced: true, policies: 1, person: true });
  });

  it('is seen and written only through that person, never through anyone else or nobody', async () => {
    const store = await openStore(':memory:');
    const alphaId = await connectAccount(store, 'alpha@example.org', '1', 0);
    const alpha = await store.user(alphaId);
    const bravo = await store.user(await connectAccount(store, 'bravo@example.net', '1', 0));
    await alpha.run(`INSERT INTO correspondents (account_id, address, user_has_written, checked_at) VALUES ('alpha@example.org', 'x@example.com', 1, 0)`);

    expect(await alpha.all('SELECT address FROM correspondents')).toEqual([{ address: 'x@example.com' }]);
    for (const other of [bravo, store.central, store.nobody]) {
      expect(await other.all('SELECT address FROM correspondents')).toEqual([]);
      expect(await other.all('SELECT id FROM mailboxes WHERE id = ?', 'alpha@example.org')).toEqual([]);
    }
    // Nor can a person write a row as someone else, into someone else's mailbox, or over their rows.
    await expect(
      bravo.run('INSERT INTO credentials (user_id, kind, key, value, updated_at) VALUES (?, ?, ?, ?, 0)', alphaId, 'model', 'openai', 'x'),
    ).rejects.toThrow('row-level security');
    await expect(
      bravo.run(`INSERT INTO correspondents (account_id, address, user_has_written, checked_at) VALUES ('alpha@example.org', 'y@example.com', 1, 0)`),
    ).rejects.toThrow();
    expect(await bravo.run('UPDATE correspondents SET user_has_written = 0')).toEqual({ changes: 0 });
    expect(await alpha.get('SELECT user_has_written FROM correspondents')).toEqual({ user_has_written: 1 });
    // Without a person, nothing of anyone's can be written.
    await expect(store.central.run('INSERT INTO preferences DEFAULT VALUES')).rejects.toThrow();
  });
});

describe('the database in the home directory', () => {
  it('is refused to a second opener while the first has it, and free again once closed', async () => {
    const paths = { databaseDir: scratch() };
    const first = await openStore(paths);
    await expect(openStore(paths)).rejects.toThrow(`Another sift (process ${process.pid}) has the database open`);
    await first.close();
    await (await openStore(paths)).close();
  });
});
