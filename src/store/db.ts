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

/**
 * Apply every `NNN_name.sql` file this database has not had, in file order, each in its own transaction.
 *
 * What has been applied is kept by file name in `schema_migrations`, not as a highest number: numbers
 * are handed out in ranges and have gaps, so a file can land with a lower number than one already
 * applied, and must still run. `PRAGMA user_version` is kept at the highest number for anything that
 * reads it. A database from before the table existed is taken to have had every file up to its
 * `user_version`, which is how it was migrated until then.
 *
 * Throws, changing nothing, if the database has had a migration this build does not have: it was last
 * opened by a newer sift, and running older code against it would misread it.
 */
function migrate(db: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .toSorted();
  const tracked = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).get() !== undefined;
  if (!tracked) {
    const before = schemaVersion(db);
    db.exec('BEGIN');
    db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT');
    const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, 0)');
    for (const file of files) if (Number.parseInt(file, 10) <= before) record.run(file);
    db.exec('COMMIT');
  }
  const applied = new Set((db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((row) => row.name));
  const unknown = [...applied].filter((name) => !files.includes(name));
  if (unknown.length > 0)
    throw new Error(
      `This database was last opened by a newer sift: it has had ${unknown.toSorted().join(', ')}, which this version does not know. Upgrade sift, or restore a backup from before the upgrade.`,
    );

  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
      record.run(file, Date.now());
      db.exec(`PRAGMA user_version = ${Math.max(schemaVersion(db), Number.parseInt(file, 10))}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
