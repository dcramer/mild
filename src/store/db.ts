import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle as overPg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as overPglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Pool, types } from 'pg';
import type { Driver } from './sql.ts';

// Not `new URL('./migrations/', import.meta.url)`: Next.js's bundler takes that for one file to bundle.
export const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Postgres sends 64-bit integers and `numeric` (what `sum()` of one gives) as text; sift's are small enough for a number. */
const { INT8, NUMERIC } = types.builtins;
types.setTypeParser(INT8, Number);
types.setTypeParser(NUMERIC, Number);
export const PARSERS = { [INT8]: Number, [NUMERIC]: Number };

/**
 * Where the database is: a Postgres server, or PGlite in a folder of the home directory. `migrateWith`:
 * the same server as the role that owns the tables. sift migrates as it, lets the role in `url` act as
 * sift_app, and then runs as that role, which owns nothing and so cannot change the tables or their policies.
 */
export type Where = { url: string; migrateWith?: string } | { dir: string };

/**
 * On a server, `warning` is set when the role sift runs as could pass row-level security; with
 * `migrateWith` set, such a role is refused instead. PGlite is not checked: it runs inside this process as
 * its superuser, with no other role to connect as, and whoever could run a statement on it could read its
 * folder anyway. sift's own queries still become sift_app there, so the policies hold them.
 */
export async function openDatabase(where: Where): Promise<Driver> {
  if ('url' in where) {
    const owner = new Pool({ connectionString: verified(where.migrateWith ?? where.url) });
    let bypass: string | null = null;
    try {
      await refuseForeign(async (text) => (await owner.query<Record<string, unknown>>(text)).rows, 'Give Sift an empty database.');
      await migratePg(overPg(owner), { migrationsFolder: MIGRATIONS });
      if (where.migrateWith) {
        const role = decodeURIComponent(new URL(where.url).username);
        await owner.query(`GRANT sift_app TO "${role.replaceAll('"', '""')}"`);
      } else bypass = await roleBypass(async (text) => (await owner.query<Record<string, unknown>>(text)).rows);
    } catch (error) {
      await owner.end();
      throw error;
    }
    if (!where.migrateWith) {
      const warning = `${bypass}, so row-level security does not hold Sift. Set DATABASE_MIGRATION_URL to that role, and DATABASE_URL to one that owns nothing.`;
      return bypass ? { ...server(owner), warning } : server(owner);
    }
    await owner.end();
    const pool = new Pool({ connectionString: verified(where.url) });
    try {
      bypass = await roleBypass(async (text) => (await pool.query<Record<string, unknown>>(text)).rows);
      if (bypass) throw new Error(`${bypass}, so row-level security would not hold Sift. Give DATABASE_URL a role that owns nothing and cannot bypass it.`);
    } catch (error) {
      await pool.end();
      throw error;
    }
    return server(pool);
  }
  const release = lock(where.dir);
  const file = new PGlite(where.dir, { parsers: PARSERS });
  try {
    await refuseForeign(async (text) => (await file.query<Record<string, unknown>>(text)).rows, 'Run sift reset-db to move it aside and start a new one.');
    await migratePglite(overPglite(file), { migrationsFolder: MIGRATIONS });
  } catch (error) {
    await file.close();
    release();
    throw error;
  }
  const driver = pglite(file);
  return { ...driver, close: async () => (await driver.close(), release()) };
}

/**
 * pg 8 treats `sslmode` `prefer`, `require` and `verify-ca` as `verify-full`, with a warning that pg 9 will
 * give them libpq's meaning, under which `require` (what Neon's addresses carry) checks no certificate.
 * Asking for `verify-full` by name keeps what sift has now through that upgrade. An address that opts into
 * libpq's meaning (`uselibpqcompat`) is left as it is.
 */
export function verified(url: string): string {
  const address = new URL(url);
  const mode = address.searchParams.get('sslmode');
  if (address.searchParams.has('uselibpqcompat') || !mode || !['prefer', 'require', 'verify-ca'].includes(mode)) return url;
  address.searchParams.set('sslmode', 'verify-full');
  return address.href;
}

/**
 * Why the role connected as could pass row-level security, or null. Each transaction becomes sift_app,
 * but a statement can `RESET ROLE` back, so the role itself must be held too: it may not be, or be able to
 * become, a superuser, a role with BYPASSRLS, or the owner of a table under a policy.
 */
export async function roleBypass(query: (text: string) => Promise<Record<string, unknown>[]>): Promise<string | null> {
  const [row] = await query(`SELECT current_user AS role,
    EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolsuper AND pg_has_role(current_user, r.oid, 'MEMBER')) AS super,
    EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolbypassrls AND pg_has_role(current_user, r.oid, 'MEMBER')) AS bypass,
    EXISTS (SELECT 1 FROM pg_class c WHERE c.relrowsecurity AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS owns`);
  const reason = row?.['super'] ? 'is a superuser' : row?.['bypass'] ? 'can bypass row-level security' : row?.['owns'] ? "can act as the tables' owner" : null;
  return reason && `The database role ${String(row!['role'])} ${reason}`;
}

/** Another sift process has the database open. */
export class DatabaseInUse extends Error {
  readonly pid: number;
  constructor(pid: number) {
    super(`Another Sift (process ${pid}) has the database open. Stop it first, or use the dashboard it serves.`);
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

/** Move a PGlite folder aside, so the next open makes a new one. Refused while a sift has it open. Returns where it went. */
export function moveAside(dir: string): string {
  const release = lock(dir);
  const to = `${dir}.${new Date().toISOString().replaceAll(':', '-')}`;
  try {
    renameSync(dir, to);
  } finally {
    release();
  }
  return to;
}

export function pglite(db: PGliteInterface): Driver {
  return {
    transaction: (opening, work) =>
      db.transaction(async (tx) => {
        await tx.exec(opening);
        return await work({
          query: async (text, params, array) => {
            const result = await tx.query<Record<string, unknown>>(text, params, array ? { rowMode: 'array' } : {});
            return { rows: result.rows };
          },
        });
      }),
    close: () => db.close(),
  };
}

function server(pool: Pool): Driver {
  return {
    transaction: async (opening, work) => {
      const client = await pool.connect();
      try {
        // Without parameters, statements go as one simple query: one round trip for all of them.
        await client.query(`BEGIN; ${opening}`);
        const result = await work({
          query: async (text, params, array) => {
            const result = array ? await client.query({ text, values: params, rowMode: 'array' }) : await client.query<Record<string, unknown>>(text, params);
            return { rows: result.rows };
          },
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

/**
 * Throws unless every migration the database has had is one of this build's. One made after our newest
 * means a newer sift opened it, and older code would misread it. Any other is from before the migrations
 * were last started over: Drizzle compares only when each was made, so it would run ours again over the
 * tables already there. `fresh` says how to start over.
 */
async function refuseForeign(query: (text: string) => Promise<Record<string, unknown>[]>, fresh: string): Promise<void> {
  const [table] = await query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`);
  if (!table?.['t']) return;
  const ours = readMigrationFiles({ migrationsFolder: MIGRATIONS });
  const known = new Set(ours.map((m) => m.hash));
  const latest = Math.max(...ours.map((m) => m.folderMillis));
  const foreign = (await query('SELECT hash, created_at FROM drizzle.__drizzle_migrations')).filter((row) => !known.has(String(row['hash'])));
  if (foreign.some((row) => Number(row['created_at']) > latest))
    throw new Error(
      'This database was last opened by a newer Sift, with migrations this version does not have. Upgrade Sift, or restore a backup from before the upgrade.',
    );
  if (foreign.length)
    throw new Error(`This database was made by an earlier Sift whose migrations have since been replaced, so it cannot be brought up to date. ${fresh}`);
}
