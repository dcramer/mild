import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openFile, readMigrations } from './db.ts';
import type { Database, Sql } from './sql.ts';

/**
 * The databases. `central` says who the people are and which mailboxes are whose; each person's mail is
 * in a database of their own, and a request or a pass holds only the one it is for.
 */
export interface Store {
  central: Sql;
  /** One person's database, migrated. Opened once and kept. */
  user(id: number): Promise<Sql>;
  close(): Promise<void>;
}

/** Where the databases are. `:memory:` keeps them all in memory, for tests. */
export type StorePaths = { dbPath: string; usersDir: string } | ':memory:';

/** Open the store, migrating each database as it is opened. */
export async function openStore(paths: StorePaths): Promise<Store> {
  if (paths !== ':memory:') mkdirSync(paths.usersDir, { recursive: true, mode: 0o700 });
  const central = await openFile(paths === ':memory:' ? ':memory:' : paths.dbPath, readMigrations('central'));
  const users = new Map<number, Promise<Database>>();
  const open = async (id: number) => {
    const path = paths === ':memory:' ? ':memory:' : join(paths.usersDir, `${id}.db`);
    const db = await openFile(path, readMigrations('user'));
    try {
      await claim(db, central, id, path);
    } catch (error) {
      db.close();
      throw error;
    }
    return db;
  };
  return {
    central,
    user: (id) => {
      let db = users.get(id);
      if (!db) users.set(id, (db = open(id)));
      return db;
    },
    close: async () => {
      central.close();
      for (const db of await Promise.allSettled(users.values())) if (db.status === 'fulfilled') db.value.close();
    },
  };
}

/**
 * Make sure `db` is person `id`'s, or throw: it must say so (a new one is marked theirs), and every
 * mailbox in it must be one the central database gives them. Then add any of theirs it lacks: mailboxes
 * are added to the central database first, so one can be missing here after a crash in between.
 */
async function claim(db: Sql, central: Sql, id: number, path: string): Promise<void> {
  const marked = await db.get<{ id: number }>('SELECT id FROM person');
  if (marked === undefined) await db.run('INSERT INTO person (one, id) VALUES (1, ?)', id);
  else if (marked.id !== id) throw new Error(`${path} is person ${marked.id}'s database, not person ${id}'s. It was moved or restored to the wrong place.`);
  const theirs = await central.all<{ id: string; created_at: number }>('SELECT id, created_at FROM accounts WHERE user_id = ?', id);
  const stray = (await db.all<{ id: string }>('SELECT id FROM mailboxes')).filter((m) => !theirs.some((a) => a.id === m.id));
  if (stray.length > 0) throw new Error(`${path} holds ${stray.map((m) => m.id).join(', ')}, which person ${id} does not have.`);
  for (const mailbox of theirs) await db.run('INSERT OR IGNORE INTO mailboxes (id, created_at) VALUES (?, ?)', mailbox.id, mailbox.created_at);
}
