import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { TestProject } from 'vitest/node';
import { MIGRATIONS } from '../src/store/db.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** A migrated, empty database image, which each test file loads instead of migrating its own. */
    template: string;
  }
}

export default async function setup(project: TestProject) {
  const pg = await PGlite.create();
  await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS });
  const dir = mkdtempSync(join(tmpdir(), 'sift-template-'));
  const path = join(dir, 'template.tar');
  writeFileSync(path, Buffer.from(await (await pg.dumpDataDir('none')).arrayBuffer()));
  await pg.close();
  project.provide('template', path);
  return () => rmSync(dir, { recursive: true, force: true });
}
