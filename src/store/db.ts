import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

/** Open (and migrate) the sift database. Pass `:memory:` in tests. */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  // Mail metadata is private: owner-only, and SQLite creates the WAL files with the same mode.
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

/** Apply `NNN_name.sql` files newer than `PRAGMA user_version`, each in its own transaction. */
function migrate(db: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .toSorted();
  const current = schemaVersion(db);
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
