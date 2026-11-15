import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { WEB_DIST } from '../dashboard/server.ts';
import { spin } from './ui.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB = join(ROOT, 'web');

function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((name) => newest(join(path, name))));
}

/**
 * Build the dashboard page if it has never been built or its sources have changed since, so running
 * sift from a checkout needs no separate build step. A packaged install ships the built page without
 * its sources, and this does nothing there.
 */
export async function ensureWebBuilt(): Promise<void> {
  const sources = [join(WEB, 'src'), join(WEB, 'index.html'), join(WEB, 'package.json'), join(ROOT, 'src/dashboard/types.ts')];
  if (!existsSync(join(WEB, 'src'))) return;
  const built = newest(join(WEB_DIST, 'index.html'));
  if (built > 0 && built >= Math.max(...sources.map(newest))) return;
  try {
    await spin('Building the dashboard', () => promisify(execFile)('pnpm', ['--filter', 'sift-web', 'build'], { cwd: ROOT }));
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim().split('\n').slice(-3).join(' ') ?? String(error);
    throw new Error(`The dashboard could not be built (${detail}). Run \`pnpm install\`, then try again.`, { cause: error });
  }
}
