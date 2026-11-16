import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { drizzle as overPg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as overPglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Pool, types } from 'pg';
import type { Driver } from './sql.ts';

export const MIGRATIONS = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Postgres sends 64-bit integers and `numeric` (what `sum()` of one gives) as text; sift's are small enough for a number. */
const { INT8, NUMERIC } = types.builtins;
types.setTypeParser(INT8, Number);
types.setTypeParser(NUMERIC, Number);
export const PARSERS = { [INT8]: Number, [NUMERIC]: Number };

/** Where the database is: a Postgres server, or PGlite in a folder of the home directory. */
export type Where = { url: string } | { dir: string };

export async function openDatabase(where: Where): Promise<Driver> {
  if ('url' in where) {
    const pool = new Pool({ connectionString: where.url });
    try {
      refuseNewer(await latestApplied(async (text) => (await pool.query<Record<string, unknown>>(text)).rows));
      await migratePg(overPg(pool), { migrationsFolder: MIGRATIONS });
    } catch (error) {
      await pool.end();
      throw error;
    }
    return server(pool);
  }
  const release = lock(where.dir);
  const file = new PGlite(where.dir, { parsers: PARSERS });
  try {
    refuseNewer(await latestApplied(async (text) => (await file.query<Record<string, unknown>>(text)).rows));
    await migratePglite(overPglite(file), { migrationsFolder: MIGRATIONS });
  } catch (error) {
    await file.close();
    release();
    throw error;
  }
  const driver = pglite(file);
  return { ...driver, close: async () => (await driver.close(), release()) };
}

/** Another sift process has the database open. */
export class DatabaseInUse extends Error {
  readonly pid: number;
  constructor(pid: number) {
    super(`Another sift (process ${pid}) has the database open. Stop it first, or use the dashboard it serves.`);
    this.pid = pid;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * PGlite is one process's alone, and does not check that itself: two writing to one folder would
 * corrupt it. So the folder is held with a lock file naming the process, and refused to any other while
 * that process is alive; one left by a process that has gone is taken over. Returns the release.
 */
function lock(dir: string): () => void {
  const path = `${dir}.lock`;
  for (;;) {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number(readFileSync(path, 'utf8'));
      if (alive(holder)) throw new DatabaseInUse(holder);
      unlinkSync(path);
    }
  }
  const release = () => {
    process.off('exit', release);
    if (Number(readFileSync(path, 'utf8')) === process.pid) unlinkSync(path);
  };
  process.on('exit', release);
  return release;
}

export function pglite(db: PGliteInterface): Driver {
  return {
    transaction: (work) =>
      db.transaction((tx) =>
        work({
          query: async (text, params) => {
            const result = await tx.query<Record<string, unknown>>(text, params);
            return { rows: result.rows, count: result.affectedRows ?? 0 };
          },
          exec: async (text) => void (await tx.exec(text)),
        }),
      ),
    close: () => db.close(),
  };
}

function server(pool: Pool): Driver {
  return {
    transaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async (text, params) => {
            const result = await client.query<Record<string, unknown>>(text, params);
            return { rows: result.rows, count: result.rowCount ?? 0 };
          },
          exec: async (text) => void (await client.query(text)),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** When the newest migration this database has had was made, or null for a new database. */
async function latestApplied(query: (text: string) => Promise<Record<string, unknown>[]>): Promise<number | null> {
  const [table] = await query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`);
  if (!table?.['t']) return null;
  const [row] = await query('SELECT max(created_at) AS at FROM drizzle.__drizzle_migrations');
  return row?.['at'] === null || row?.['at'] === undefined ? null : Number(row['at']);
}

/**
 * Throws if the database has had a migration made after the newest this build has: a newer sift last
 * opened it, and running older code against it would misread it.
 */
function refuseNewer(applied: number | null): void {
  const { entries } = JSON.parse(readFileSync(`${MIGRATIONS}meta/_journal.json`, 'utf8')) as { entries: { when: number }[] };
  const ours = Math.max(...entries.map((e) => e.when));
  if (applied !== null && applied > ours)
    throw new Error(
      'This database was last opened by a newer sift, with migrations this version does not have. Upgrade sift, or restore a backup from before the upgrade.',
    );
}
