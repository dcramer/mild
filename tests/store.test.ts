import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/store/schema.ts';
import { addMailbox, connectAccount, connectedAddresses, deleteUser, recordSync, removeMailbox } from '../src/store/accounts.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { listLabels, updateLabel } from '../src/store/labels.ts';
import { accounts, labels } from '../src/store/query.ts';
import { DatabaseInUse, moveAside, pglite, roleBypass, verified } from '../src/store/db.ts';
import { openStore, storeOn } from '../src/store/store.ts';
import { loadKeyring } from '../src/secrets.ts';
import type { Disposition } from '../src/triage/types.ts';
import { freshStore, onePerson, openUserDb, raw, recordEverything, rowsBy, superuser } from './fixtures.ts';
import { facts, withSampleLabels } from './helpers.ts';

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
    const db = await openUserDb('acct');
    const insert = (account: string, id: string, disposition: Disposition) =>
      db.insert(labels).values({ accountId: account, id, name: 'N', description: '', disposition, gmailLabel: 'sift/n', position: 0 }).execute();
    await insert('acct', 'n', 'archive');
    await expect(insert('acct', 'x', 'delete' as Disposition)).rejects.toThrow();
    await expect(insert('missing', 'y', 'keep')).rejects.toThrow();
  });

  it('keep the database where they were applied, and refuse one a newer sift has migrated', async () => {
    const paths = { databaseDir: scratch(), keys: loadKeyring({}) };
    const first = await openStore(paths);
    await connectAccount(first, 'me@example.org', '1', 0);
    await first.close();
    const again = await openStore(paths);
    expect(await again.central.select({ id: accounts.id }).from(accounts)).toEqual([{ id: 'me@example.org' }]);
    await again.close();

    const raw = new PGlite(paths.databaseDir);
    await raw.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('from-the-future', $1)`, [Date.UTC(2999, 0)]);
    await raw.close();
    await expect(openStore(paths)).rejects.toThrow('last opened by a newer Sift');
  });

  it('start over in a new database once the old one is moved aside, which is refused while it is open', async () => {
    const paths = { databaseDir: scratch(), keys: loadKeyring({}) };
    const first = await openStore(paths);
    await connectAccount(first, 'me@example.org', '1', 0);
    expect(() => moveAside(paths.databaseDir)).toThrow(DatabaseInUse);
    await first.close();
    const old = moveAside(paths.databaseDir);
    expect(existsSync(old)).toBe(true);
    const fresh = await openStore(paths);
    expect(await fresh.central.select({ id: accounts.id }).from(accounts)).toEqual([]);
    await fresh.close();
  });

  it('refuse a database made by migrations since replaced, rather than run them again over it', async () => {
    const paths = { databaseDir: scratch(), keys: loadKeyring({}) };
    await (await openStore(paths)).close();
    const raw = new PGlite(paths.databaseDir);
    await raw.query(`UPDATE drizzle.__drizzle_migrations SET hash = 'replaced' WHERE id = 1`);
    await raw.close();
    await expect(openStore(paths)).rejects.toThrow('sift reset-db');
  });
});

describe('a Postgres address', () => {
  it('names verify-full for every SSL mode pg treats as it, so pg 9 cannot stop checking the certificate', () => {
    const at = (query: string) => `postgres://app:p%40ss@db.example.com/sift${query}`;
    for (const mode of ['prefer', 'require', 'verify-ca'])
      expect(verified(at(`?sslmode=${mode}&channel_binding=require`))).toBe(at('?sslmode=verify-full&channel_binding=require'));
    for (const query of ['', '?sslmode=disable', '?sslmode=no-verify', '?sslmode=verify-full', '?uselibpqcompat=true&sslmode=require'])
      expect(verified(at(query))).toBe(at(query));
  });
});

describe("a person's data", () => {
  it('is in tables that hold every query to row-level security, the owner included', async () => {
    const { central } = await freshStore();
    const tables = await raw(central).all<{ name: string; enabled: boolean; forced: boolean; policies: number; person: boolean }>(
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
    const store = await freshStore();
    const alphaId = await connectAccount(store, 'alpha@example.org', '1', 0);
    const alpha = await store.user(alphaId);
    const bravo = await store.user(await connectAccount(store, 'bravo@example.net', '1', 0));
    await raw(alpha).run(
      `INSERT INTO correspondents (account_id, address_hash, domain_hash, user_has_written, checked_at) VALUES ('alpha@example.org', 'x@example.com', 'example.com', true, 0)`,
    );

    expect(await raw(alpha).all('SELECT address_hash FROM correspondents')).toEqual([{ address_hash: 'x@example.com' }]);
    for (const other of [bravo, store.central, store.nobody]) {
      expect(await raw(other).all('SELECT address_hash FROM correspondents')).toEqual([]);
      expect(await raw(other).all('SELECT id FROM mailboxes WHERE id = ?', 'alpha@example.org')).toEqual([]);
    }
    // Nor can a person write a row as someone else, into someone else's mailbox, or over their rows.
    await expect(raw(bravo).run('INSERT INTO credentials (user_id, kind, key, value) VALUES (?, ?, ?, ?)', alphaId, 'model', 'openai', 'x')).rejects.toThrow(
      'row-level security',
    );
    await expect(
      raw(bravo).run(
        `INSERT INTO correspondents (account_id, address_hash, domain_hash, user_has_written, checked_at) VALUES ('alpha@example.org', 'y@example.com', 'example.com', true, 0)`,
      ),
    ).rejects.toThrow();
    expect(await raw(bravo).run('UPDATE correspondents SET user_has_written = false')).toEqual({ changes: 0 });
    expect(await raw(alpha).get('SELECT user_has_written FROM correspondents')).toEqual({ user_has_written: true });
    // Without a person, nothing of anyone's can be written.
    await expect(raw(store.central).run('INSERT INTO preferences DEFAULT VALUES')).rejects.toThrow();
  });

  it("goes with them when they are deleted, and no one else's does", async () => {
    const store = await freshStore();
    const alpha = await connectAccount(store, 'alpha@example.org', '1', 0);
    const bravo = await connectAccount(store, 'bravo@example.net', '1', 0);
    await recordEverything(await store.user(alpha), 'alpha@example.org');
    await recordEverything(await store.user(bravo), 'bravo@example.net');
    const before = await rowsBy('user_id');
    expect(Object.keys(before).length).toBeGreaterThan(10);
    for (const [name, counts] of Object.entries(before)) expect(Object.keys(counts), name).toEqual([String(alpha), String(bravo)]);

    await deleteUser(store, alpha);
    const after = await rowsBy('user_id');
    for (const [name, counts] of Object.entries(before)) expect(after[name], name).toEqual({ [bravo]: counts[bravo] });
    expect((await (await superuser()).query('SELECT id, owner FROM users')).rows).toEqual([{ id: bravo, owner: true }]);
  });
});

describe("a mailbox's data", () => {
  it('is in tables that each have a key to the mailbox that deletes the row with it', async () => {
    const { rows } = await (
      await superuser()
    ).query<{ name: string; cascades: boolean }>(
      `SELECT c.relname AS name,
              EXISTS (SELECT 1 FROM pg_constraint k
                      WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.confrelid = 'mailboxes'::regclass AND k.confdeltype = 'c'
                        AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum = ANY (k.conkey))
                            = ARRAY['account_id', 'user_id']) AS cascades
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'account_id')
       ORDER BY 1`,
    );
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row, row.name).toEqual({ name: row.name, cascades: true });
  });

  it('goes with it when it is removed, with its sign-in, and nothing of another mailbox does', async () => {
    const { store } = await onePerson('alpha@example.org', 'alpha@work.example.com');
    const bravo = await connectAccount(store, 'bravo@example.net', '1', 0);
    const alpha = await store.user(1);
    await recordEverything(alpha, 'alpha@example.org');
    await recordEverything(alpha, 'alpha@work.example.com');
    await recordEverything(await store.user(bravo), 'bravo@example.net');
    const before = await rowsBy('account_id');
    expect(Object.keys(before).length).toBeGreaterThan(10);

    expect(await removeMailbox(store, bravo, 'alpha@work.example.com')).toBe(false);
    expect(await rowsBy('account_id')).toEqual(before);
    expect(await removeMailbox(store, 1, 'alpha@work.example.com')).toBe(true);
    const after = await rowsBy('account_id');
    for (const [name, counts] of Object.entries(before)) {
      const { ['alpha@work.example.com']: gone, ...rest } = counts;
      expect(gone, name).toBeGreaterThan(0);
      expect(after[name], name).toEqual(rest);
    }
    expect(await raw(alpha).all(`SELECT key FROM credentials WHERE kind = 'gmail' ORDER BY key`)).toEqual([{ key: 'alpha@example.org' }]);
    expect(await connectedAddresses(store.central)).toEqual(['alpha@example.org', 'bravo@example.net']);
  });
});

describe('a proposal', () => {
  it('names what the rule it proposes would do', async () => {
    const { db } = await onePerson('alpha@example.org');
    const propose = (disposition: string | null) =>
      raw(db).run(
        `INSERT INTO proposals (account_id, match, conditions, label_id, disposition, agreed, created_at) VALUES ('alpha@example.org', '{}', 'c', 'newsletter', ?, 2, 0)`,
        disposition,
      );
    await expect(propose(null)).rejects.toThrow();
    await expect(propose('review')).rejects.toThrow();
    await propose('keep');
  });
});

describe('a new mailbox', () => {
  it('starts with Leave in inbox alone, once, and keeps its labels when connected again', async () => {
    const store = await freshStore();
    const db = await store.user(await connectAccount(store, 'alpha@example.org', '1', 0));
    expect(await listLabels(db, 'alpha@example.org')).toEqual([{ id: 'everything_else', name: 'Leave in inbox', description: '', disposition: 'keep' }]);
    await withSampleLabels(db, 'alpha@example.org');
    await updateLabel(db, 'alpha@example.org', 'newsletter', { name: 'Reading' });
    await connectAccount(store, 'alpha@example.org', '9', 5);
    await addMailbox(db, 'alpha@example.org', '10');
    expect((await listLabels(db, 'alpha@example.org')).map((l) => l.name)).toContain('Reading');
    // Leave in inbox is listed after the person's own; the page puts it first.
    expect((await listLabels(db, 'alpha@example.org')).at(-1)?.id).toBe('everything_else');
    // A store opened afresh puts back a mailbox missing from a person's database, with its one label.
    await raw(db).run('DELETE FROM mailboxes');
    expect(await listLabels(db, 'alpha@example.org')).toEqual([]);
    const reopened = await storeOn(pglite(await superuser()), loadKeyring({})).user(1);
    expect((await listLabels(reopened, 'alpha@example.org')).map((l) => l.id)).toEqual(['everything_else']);
  });

  it('made before Everything Else existed is given it by a migration, after its own labels, and it becomes Leave in inbox', async () => {
    const { db } = await onePerson('alpha@example.org');
    await withSampleLabels(db, 'alpha@example.org');
    await raw(db).run(`DELETE FROM labels WHERE id = 'everything_else'`);
    const migration = readFileSync(new URL('0030_every_mailbox_has_everything_else.sql', MIGRATIONS), 'utf8');
    await (await superuser()).exec(migration);
    await (await superuser()).exec(migration);
    expect((await listLabels(db, 'alpha@example.org')).filter((l) => l.id === 'everything_else')).toHaveLength(1);
    expect((await listLabels(db, 'alpha@example.org')).at(-1)?.id).toBe('everything_else');
    // Its old default said nothing of the person's, so it goes; what they wrote stays theirs.
    const renamed = readFileSync(new URL('0034_leave_in_inbox.sql', MIGRATIONS), 'utf8');
    await (await superuser()).exec(renamed);
    expect((await listLabels(db, 'alpha@example.org')).at(-1)).toEqual({ id: 'everything_else', name: 'Leave in inbox', description: '', disposition: 'keep' });
    await raw(db).run(`UPDATE labels SET name = 'The rest', description = 'Bills I still owe.' WHERE id = 'everything_else'`);
    await (await superuser()).exec(renamed);
    expect((await listLabels(db, 'alpha@example.org')).at(-1)).toMatchObject({ name: 'Leave in inbox', description: 'Bills I still owe.' });
  });

  it('needs its labels to exist for anything that names one', async () => {
    const { db } = await onePerson('alpha@example.org');
    await recordSync(db, 'alpha@example.org', [facts({ accountId: 'alpha@example.org', messageId: 'm1' })], '2', 0);
    await expect(
      recordDecision(db, 'alpha@example.org', 'm1', { disposition: 'archive', subscription: 'preserve', stage: 'model', labelId: 'nonsense', reason: 'r' }),
    ).rejects.toThrow();
    await expect(
      raw(db).run(
        `INSERT INTO rules (id, account_id, position, match, except_matches, conditions, when_label, source, created_at) VALUES ('r', 'alpha@example.org', 0, '{}', '[]', 'c', 'nonsense', 'user', 0)`,
      ),
    ).rejects.toThrow();
  });
});

describe('the database in the home directory', () => {
  it('is refused to a second opener while the first has it, and free again once closed', async () => {
    const paths = { databaseDir: scratch(), keys: loadKeyring({}) };
    const first = await openStore(paths);
    await expect(openStore(paths)).rejects.toThrow(`Another Sift (process ${process.pid}) has the database open`);
    await first.close();
    await (await openStore(paths)).close();
  });
});

describe('the role sift connects to a server as', () => {
  it('is named when it could pass row-level security', async () => {
    const pg = await superuser();
    // In a transaction rolled back after, so the roles and table go with it.
    const as = async (setup: string, role: string | null) =>
      await pg.transaction(async (tx) => {
        await tx.exec(setup);
        if (role) await tx.exec(`SET LOCAL ROLE ${role}`);
        const found = await roleBypass(async (text) => (await tx.query<Record<string, unknown>>(text)).rows);
        await tx.rollback();
        return found;
      });
    expect(await as('', 'sift_app')).toBeNull();
    expect(await as('CREATE ROLE runner; GRANT sift_app TO runner', 'runner')).toBeNull();
    expect(await as('', null)).toMatch(/^The database role \w+ is a superuser$/);
    expect(await as('CREATE ROLE runner BYPASSRLS', 'runner')).toBe('The database role runner can bypass row-level security');
    expect(await as('CREATE ROLE wide BYPASSRLS; CREATE ROLE runner; GRANT wide TO runner', 'runner')).toMatch(/runner can bypass/);
    const owned = 'CREATE ROLE owner; CREATE TABLE held (x int); ALTER TABLE held ENABLE ROW LEVEL SECURITY; ALTER TABLE held OWNER TO owner';
    expect(await as(`${owned}; CREATE ROLE runner; GRANT owner TO runner`, 'runner')).toBe("The database role runner can act as the tables' owner");
  });

  it('is warned about by the store, for whoever starts sift to be told', async () => {
    const driver = pglite(await superuser());
    expect(storeOn(driver, loadKeyring({})).warning).toBeUndefined();
    expect(storeOn({ ...driver, warning: 'The database role x is a superuser' }, loadKeyring({})).warning).toBe('The database role x is a superuser');
  });
});
