import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openFile, readMigrations } from './db.ts';
import { type Database, sqlite } from './sql.ts';

/** Per-person tables in the order they can be filled, each before anything that refers to it. */
const TABLES = [
  'messages',
  'decisions',
  'actions',
  'labels',
  'rules',
  'proposals',
  'correspondents',
  'feedback',
  'examples',
  'suggestion_bodies',
  'eval_runs',
] as const;

const quote = (path: string) => `'${path.replaceAll("'", "''")}'`;
const columns = (db: DatabaseSync, schema: string, table: string) =>
  (db.prepare(`SELECT name FROM pragma_table_info(?, ?)`).all(table, schema) as { name: string }[]).map((c) => c.name);

/**
 * Split a home's single `sift.db`, from before each person had a database of their own, into the
 * central one and one per person. The old file is kept beside them as `sift.db.before-split`, untouched
 * after its last migration. Nothing happens when the home is already split.
 *
 * The new files are written to a folder of their own and moved into place last, so a crash before the
 * moves leaves the old database where it was and the next start does it again; one during them is
 * finished on the next start.
 */
export async function splitSingle(paths: { dbPath: string; usersDir: string }): Promise<void> {
  const work = join(dirname(paths.dbPath), 'split-in-progress');
  const before = `${paths.dbPath}.before-split`;
  if (existsSync(work) && !existsSync(paths.dbPath) && existsSync(before)) return finish(paths, work);
  if (!isSingle(paths.dbPath)) return;
  if (existsSync(paths.usersDir) && readdirSync(paths.usersDir).length > 0)
    throw new Error(`${paths.usersDir} already has databases in it, beside a ${paths.dbPath} from before there was one per person. Move one of them away.`);

  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, 'users'), { recursive: true, mode: 0o700 });
  (await openSingle(paths.dbPath)).close();

  const central = await openFile(join(work, 'sift.db'), readMigrations('central'));
  central.close();
  const db = new DatabaseSync(join(work, 'sift.db'));
  db.exec(`ATTACH DATABASE ${quote(paths.dbPath)} AS old`);
  db.exec('BEGIN');
  db.exec('INSERT INTO users (id, owner, created_at) SELECT id, owner, created_at FROM old.users');
  db.exec('INSERT INTO accounts (id, email, user_id, created_at) SELECT id, email, user_id, created_at FROM old.accounts WHERE user_id IS NOT NULL');
  db.exec('COMMIT');
  const people = (db.prepare('SELECT id FROM users').all() as { id: number }[]).map((u) => u.id);
  db.close();

  for (const person of people) {
    const file = join(work, 'users', `${person}.db`);
    (await openFile(file, readMigrations('user'))).close();
    const user = new DatabaseSync(file);
    user.exec(`ATTACH DATABASE ${quote(paths.dbPath)} AS old`);
    user.exec('BEGIN');
    user
      .prepare(
        `INSERT INTO mailboxes (id, history_id, last_synced_at, filters_checked_at, created_at)
         SELECT id, history_id, last_synced_at, filters_checked_at, created_at FROM old.accounts WHERE user_id = ?`,
      )
      .run(person);
    for (const table of TABLES) {
      const kept = columns(user, 'main', table).filter((c) => columns(user, 'old', table).includes(c));
      const list = kept.join(', ');
      user.exec(`INSERT INTO main.${table} (${list}) SELECT ${list} FROM old.${table} WHERE account_id IN (SELECT id FROM main.mailboxes)`);
    }
    user.exec(
      `INSERT INTO main.eval_results (${columns(user, 'main', 'eval_results').join(', ')})
       SELECT ${columns(user, 'main', 'eval_results').join(', ')} FROM old.eval_results WHERE run_id IN (SELECT id FROM main.eval_runs)`,
    );
    user.exec('COMMIT');
    user.exec('DETACH DATABASE old');
    user.close();
  }

  renameSync(paths.dbPath, before);
  finish(paths, work);
}

function finish(paths: { dbPath: string; usersDir: string }, work: string): void {
  const users = join(work, 'users');
  if (existsSync(users)) {
    rmSync(paths.usersDir, { recursive: true, force: true });
    renameSync(users, paths.usersDir);
  }
  renameSync(join(work, 'sift.db'), paths.dbPath);
  rmSync(work, { recursive: true, force: true });
}

/** Whether `path` is a database from before there was one per person: it holds the mail itself. */
function isSingle(path: string): boolean {
  if (!existsSync(path)) return false;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages'`).get() !== undefined;
  } finally {
    db.close();
  }
}

/**
 * Open a database from before there was one per person, bringing it up to the last schema it had. Only
 * splitting it and the tests of its old migrations open one.
 */
export async function openSingle(path: string): Promise<Database> {
  const migrations = readMigrations('legacy');
  const file = new DatabaseSync(path);
  // Before `schema_migrations`, what had run was `PRAGMA user_version`, a highest number.
  if (file.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`).get() === undefined) {
    const before = (file.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    file.exec('BEGIN');
    file.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT');
    const record = file.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, 0)');
    for (const { name } of migrations) if (Number.parseInt(name, 10) <= before) record.run(name);
    file.exec('COMMIT');
  }
  file.exec('PRAGMA foreign_keys = ON;');
  const db = sqlite(file);
  try {
    await migrate(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
