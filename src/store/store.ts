import { openDatabase } from './db.ts';
import { type Sql, handle } from './sql.ts';

/**
 * The database. `central` says who the people are and which mailboxes are whose, and sees no one's
 * mail; `user(id)` sees only that person's (row-level security, `handle` in `src/store/sql.ts`).
 */
export interface Store {
  central: Sql;
  /** One person's handle. The first time, it makes their preferences and copies in any mailbox of theirs it lacks. */
  user(id: number): Promise<Sql>;
  /** Sees no one's rows, for a request with nobody behind it. */
  nobody: Sql;
  close(): Promise<void>;
}

/** Where the database is: a Postgres server's address, or else PGlite in `databaseDir`. `:memory:` for tests. */
export type StorePaths = { databaseUrl?: string | undefined; databaseDir: string } | ':memory:';

/** Open the database, migrating it first. */
export async function openStore(paths: StorePaths): Promise<Store> {
  const driver = await openDatabase(paths === ':memory:' ? ':memory:' : paths.databaseUrl ? { url: paths.databaseUrl } : { dir: paths.databaseDir });
  const central = handle(driver, null);
  const opened = new Map<number, Promise<Sql>>();
  const open = async (id: number) => {
    const db = handle(driver, id);
    // A mailbox is added to `accounts` first, so one can be missing here after a crash in between.
    const theirs = await central.all<{ id: string; created_at: number }>('SELECT id, created_at FROM accounts WHERE user_id = ?', id);
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO preferences DEFAULT VALUES ON CONFLICT DO NOTHING');
      for (const mailbox of theirs) await tx.run('INSERT INTO mailboxes (id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING', mailbox.id, mailbox.created_at);
    });
    return db;
  };
  return {
    central,
    user: (id) => {
      let db = opened.get(id);
      if (!db) opened.set(id, (db = open(id)));
      return db;
    },
    nobody: handle(driver, 0),
    close: () => driver.close(),
  };
}

/** For tests: a database in memory with one person in it, who owns the install, and their handle. */
export async function openUserDb(): Promise<Sql> {
  const store = await openStore(':memory:');
  const { id } = (await store.central.get<{ id: number }>('INSERT INTO users (owner, created_at) VALUES (1, 0) RETURNING id'))!;
  return await store.user(id);
}
