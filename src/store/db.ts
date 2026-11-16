import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { type Database, type Sql, sqlite } from './sql.ts';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

/** A migration: its file name, which is how it is recorded, and its SQL. */
export interface Migration {
  name: string;
  sql: string;
}

/** The `NNN_name.sql` files in `dir`, in the order they run. */
export function readMigrations(dir: URL = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .toSorted()
    .map((name) => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') }));
}

/** Open (and migrate) the sift database. Pass `:memory:` in tests. */
export async function openDb(path: string): Promise<Database> {
  const file = new DatabaseSync(path);
  // Mail metadata is private: owner-only, and SQLite creates the WAL files with the same mode.
  if (path !== ':memory:') chmodSync(path, 0o600);
  file.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const migrations = readMigrations();
  adoptVersion(file, migrations);
  const db = sqlite(file);
  try {
    await migrate(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  // Kept at the highest number for anything that reads it.
  const highest = Math.max(0, ...(await db.all<{ name: string }>('SELECT name FROM schema_migrations')).map((row) => Number.parseInt(row.name, 10)));
  file.exec(`PRAGMA user_version = ${highest}`);
  return db;
}

export async function schemaVersion(db: Sql): Promise<number> {
  return (await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
}

/**
 * A database from before `schema_migrations` existed was migrated by `PRAGMA user_version`, a highest
 * number: take it to have had every file up to that.
 */
function adoptVersion(db: DatabaseSync, migrations: readonly Migration[]): void {
  if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).get() !== undefined) return;
  const before = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  db.exec('BEGIN');
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT');
  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, 0)');
  for (const { name } of migrations) if (Number.parseInt(name, 10) <= before) record.run(name);
  db.exec('COMMIT');
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
