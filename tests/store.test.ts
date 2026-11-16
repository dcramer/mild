import { mkdtempSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { connectAccount } from '../src/store/accounts.ts';
import { migrate, openUserDb } from '../src/store/db.ts';
import { sqlite } from '../src/store/sql.ts';
import { openStore } from '../src/store/store.ts';

const scratch = () => mkdtempSync(join(tmpdir(), 'sift-db-'));

describe('migrations', () => {
  it("migrates a fresh person's database and enforces constraints", async () => {
    const db = await openUserDb(':memory:');
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
    db.close();
  });

  it('records each migration by name, and applies one that arrives with a lower number than those already applied', async () => {
    const db = sqlite(new DatabaseSync(':memory:'));
    const table = (name: string) => ({ name, sql: `CREATE TABLE t_${name.slice(0, 3)} (x)` });
    await migrate(db, [table('010_a.sql'), table('020_b.sql')]);
    await migrate(db, [table('010_a.sql'), table('015_late.sql'), table('020_b.sql')]);
    expect((await db.all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')).map((row) => row.name)).toEqual([
      '010_a.sql',
      '015_late.sql',
      '020_b.sql',
    ]);
    expect(await db.get(`SELECT 1 AS yes FROM sqlite_master WHERE name = 't_015'`)).toEqual({ yes: 1 });
  });

  it('refuses a database a newer sift has migrated, and leaves it as it was', async () => {
    const path = join(scratch(), '1.db');
    (await openUserDb(path)).close();
    const newer = new DatabaseSync(path);
    newer.exec(`INSERT INTO schema_migrations (name, applied_at) VALUES ('999_from_the_future.sql', 1)`);
    newer.close();
    await expect(openUserDb(path)).rejects.toThrow(/last opened by a newer sift: it has had 999_from_the_future\.sql/);
  });
});

describe("a person's database", () => {
  const ALPHA = 'alpha@example.org';
  const BETA = 'beta@example.net';

  /** A home on disk with two people, Alpha (1) and Beta (2), each of whose databases has been opened. */
  async function home() {
    const dir = scratch();
    const paths = { dbPath: join(dir, 'sift.db'), usersDir: join(dir, 'users') };
    const store = await openStore(paths);
    await connectAccount(store, ALPHA, '1', 0);
    await connectAccount(store, BETA, '1', 0);
    await store.close();
    return paths;
  }

  it('is a file of its own, holding only its own mailboxes', async () => {
    const paths = await home();
    expect(
      readdirSync(paths.usersDir)
        .filter((f) => f.endsWith('.db'))
        .toSorted(),
    ).toEqual(['1.db', '2.db']);
    const store = await openStore(paths);
    expect(await (await store.user(1)).all('SELECT id FROM mailboxes')).toEqual([{ id: ALPHA }]);
    expect(await (await store.user(2)).all('SELECT id FROM mailboxes')).toEqual([{ id: BETA }]);
    expect(await (await store.user(2)).get('SELECT id FROM person')).toEqual({ id: 2 });
    await store.close();
  });

  it("is refused when it is someone else's, or holds a mailbox that is not theirs", async () => {
    const paths = await home();
    // Swapped, as a restore to the wrong place would leave them.
    renameSync(join(paths.usersDir, '1.db'), join(paths.usersDir, 'swap.db'));
    renameSync(join(paths.usersDir, '2.db'), join(paths.usersDir, '1.db'));
    renameSync(join(paths.usersDir, 'swap.db'), join(paths.usersDir, '2.db'));
    const swapped = await openStore(paths);
    await expect(swapped.user(1)).rejects.toThrow("is person 2's database, not person 1's");
    await expect(swapped.user(2)).rejects.toThrow("is person 1's database, not person 2's");
    // Refused once, refused for as long as this store is open.
    await expect(swapped.user(1)).rejects.toThrow();
    await swapped.close();

    const again = await home();
    const file = new DatabaseSync(join(again.usersDir, '1.db'));
    file.prepare('INSERT INTO mailboxes (id, created_at) VALUES (?, 0)').run(BETA);
    file.close();
    const stray = await openStore(again);
    await expect(stray.user(1)).rejects.toThrow(`holds ${BETA}, which person 1 does not have`);
    await stray.close();
  });
});
