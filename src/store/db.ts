import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { type Database, type Sql, sqlite } from './sql.ts';

/** A migration: its file name, which is how it is recorded, and its SQL. */
export interface Migration {
  name: string;
  sql: string;
}

/** The `NNN_name.sql` files in one of `migrations/`'s folders, in the order they run. */
export function readMigrations(folder: 'central' | 'user'): Migration[] {
  const dir = new URL(`./migrations/${folder}/`, import.meta.url);
  return readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .toSorted()
    .map((name) => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') }));
}

/** One person's database on its own, with no central one: for tests and tools. */
export const openUserDb = (path: string): Promise<Database> => openFile(path, readMigrations('user'));

/** Open a SQLite file and bring it up to `migrations`. */
export async function openFile(path: string, migrations: readonly Migration[]): Promise<Database> {
  const file = new DatabaseSync(path);
  // Mail metadata is private: owner-only, and SQLite creates the WAL files with the same mode.
  if (path !== ':memory:') chmodSync(path, 0o600);
  file.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const db = sqlite(file);
  try {
    await migrate(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/**
 * Apply every migration this database has not had, in order, each in its own transaction.
 *
 * What has been applied is kept by name in `schema_migrations`, not as a highest number: numbers are
 * handed out in ranges and have gaps, so a file can land with a lower number than one already applied,
 * and must still run.
 *
 * Throws, changing nothing, if the database has had a migration this build does not have: it was last
 * opened by a newer sift, and running older code against it would misread it.
 */
export async function migrate(db: Sql, migrations: readonly Migration[]): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT');
  const applied = new Set((await db.all<{ name: string }>('SELECT name FROM schema_migrations')).map((row) => row.name));
  const known = new Set(migrations.map((m) => m.name));
  const unknown = [...applied].filter((name) => !known.has(name));
  if (unknown.length > 0)
    throw new Error(
      `This database was last opened by a newer sift: it has had ${unknown.toSorted().join(', ')}, which this version does not know. Upgrade sift, or restore a backup from before the upgrade.`,
    );
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', migration.name, Date.now());
    });
  }
}
