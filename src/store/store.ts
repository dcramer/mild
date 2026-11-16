import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openFile, readMigrations } from './db.ts';
import { splitSingle } from './split.ts';
import type { Database, Sql } from './sql.ts';

/**
 * The databases. `central` says who the people are and which mailboxes are whose; each person's mail is
 * in a database of their own, and a request or a pass holds only the one it is for.
 */
export interface Store {
  central: Sql;
  /** One person's database, migrated. Opened once and kept. */
  user(id: number): Promise<Sql>;
  close(): void;
}

/** Where the databases are. `:memory:` keeps them all in memory, for tests. */
export type StorePaths = { dbPath: string; usersDir: string } | ':memory:';

/**
 * Open the store, migrating each database as it is opened. A home from before there was a database per
 * person is split first (`splitSingle`).
 */
export async function openStore(paths: StorePaths): Promise<Store> {
  if (paths !== ':memory:') {
    await splitSingle(paths);
    mkdirSync(paths.usersDir, { recursive: true, mode: 0o700 });
  }
  const central = await openFile(paths === ':memory:' ? ':memory:' : paths.dbPath, readMigrations('central'));
  const users = new Map<number, Promise<Database>>();
  const open = async (id: number) => {
    const db = await openFile(paths === ':memory:' ? ':memory:' : join(paths.usersDir, `${id}.db`), readMigrations('user'));
    // Mailboxes are added to the central database first, so one can be missing here after a crash in between.
    for (const { id: mailbox, created_at } of await central.all<{ id: string; created_at: number }>(
      'SELECT id, created_at FROM accounts WHERE user_id = ?',
      id,
    ))
      await db.run('INSERT OR IGNORE INTO mailboxes (id, created_at) VALUES (?, ?)', mailbox, created_at);
    return db;
  };
  return {
    central,
    user: (id) => {
      let db = users.get(id);
      if (!db) users.set(id, (db = open(id)));
      return db;
    },
    close: () => {
      central.close();
      for (const db of users.values()) void db.then((d) => d.close());
    },
  };
}
