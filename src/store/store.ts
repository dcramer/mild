import { ensureMailbox } from './accounts.ts';
import { openDatabase } from './db.ts';
import { accounts, eq, preferences } from './query.ts';
import { type Driver, type Sql, handle } from './sql.ts';

/**
 * The database. `central` says who the people are and which mailboxes are whose, and sees no one's
 * mail; `user(id)` sees only that person's (row-level security, `handle` in `src/store/sql.ts`).
 */
export interface Store {
  central: Sql;
  /** One person's handle. The first time, it makes their preferences and copies in any mailbox of theirs it lacks. */
  user(id: number): Promise<Sql>;
  /** Drop a person's handle, after they were deleted, so a later `user(id)` does not hand it out. */
  forget(id: number): void;
  /** Sees no one's rows, for a request with nobody behind it. */
  nobody: Sql;
  /** For whoever runs sift, said when it starts: the database role it runs as is not held by row-level security. */
  warning?: string;
  close(): Promise<void>;
}

/** Where the database is: a Postgres server's address, or else PGlite in `databaseDir`. */
type StorePaths = { databaseUrl?: string | undefined; databaseMigrationUrl?: string | undefined; databaseDir: string };

/** Open the database, migrating it first. */
export async function openStore(paths: StorePaths): Promise<Store> {
  const { databaseUrl: url, databaseMigrationUrl: migrateWith, databaseDir: dir } = paths;
  return storeOn(await openDatabase(url ? { url, ...(migrateWith ? { migrateWith } : {}) } : { dir }));
}

/** The store over a database that is open and migrated. */
export function storeOn(driver: Driver): Store {
  const central = handle(driver, null);
  const opened = new Map<number, Promise<Sql>>();
  const open = async (id: number) => {
    const db = handle(driver, id);
    // A mailbox is added to `accounts` first, so one can be missing here after a crash in between.
    const theirs = await central.select({ id: accounts.id, createdAt: accounts.createdAt }).from(accounts).where(eq(accounts.userId, id));
    await db.transaction(async (tx) => {
      await tx.insert(preferences).values({}).onConflictDoNothing();
      for (const mailbox of theirs) await ensureMailbox(tx, mailbox);
    });
    return db;
  };
  return {
    central,
    user: (id) => {
      let db = opened.get(id);
      if (!db) {
        opened.set(id, (db = open(id)));
        // One that failed (the person was deleted meanwhile) is not kept.
        db.catch(() => opened.delete(id));
      }
      return db;
    },
    forget: (id) => void opened.delete(id),
    nobody: handle(driver, 0),
    ...(driver.warning ? { warning: driver.warning } : {}),
    close: () => driver.close(),
  };
}
