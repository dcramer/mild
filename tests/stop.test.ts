import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { tempDir } from './helpers.ts';

/** Postgres's control file says how the database was left: shut down (1), or open as after a crash (6), recovered at the next open. */
const SHUT_DOWN = 1;
const stateOf = (home: string) => readFileSync(join(home, 'database/global/pg_control')).readInt32LE(16);

it("leaves the home's PGlite shut down when the server is stopped as Next.js stops it", async () => {
  const home = tempDir();
  // A process that opens the host with one request, then stops as Next.js does on SIGTERM: its own handler exits once the requests under way are done.
  const child = `
    const { respond } = await import(${JSON.stringify(new URL('../src/app/instance.ts', import.meta.url).href)});
    await respond(new Request('http://localhost/api/session'));
    process.once('SIGTERM', () => setTimeout(() => process.exit(143), 10));
    process.kill(process.pid, 'SIGTERM');
  `;
  const stopped = promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '--eval', child], {
    env: { PATH: process.env['PATH'], SIFT_HOME: home },
  });
  await expect(stopped).rejects.toMatchObject({ code: 143 });
  expect(stateOf(home)).toBe(SHUT_DOWN);
});
