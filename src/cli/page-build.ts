import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { spin } from './ui.ts';

/** The checkout sift runs from. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Next.js reports how it is used to Vercel unless told not to; Sift sends nothing it is not asked to. */
export const NO_TELEMETRY = { NEXT_TELEMETRY_DISABLED: '1' };

/**
 * What the page is built from: its own code, the server's that it takes types and its policy from, and the
 * Workflow code that runs in Next.js here (the rest of src/ in its build is the Vercel host's).
 */
const SOURCES = [
  'app',
  'web/src',
  'public',
  'proxy.ts',
  'instrumentation.ts',
  'src/app/flow.ts',
  'src/app/process.ts',
  'next.config.js',
  'postcss.config.mjs',
  'package.json',
  'src/dashboard/types.ts',
  'src/dashboard/policy.ts',
  'src/triage/types.ts',
];

function newest(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((name) => newest(join(path, name))));
}

/**
 * Build the page if it has never been built or its sources have changed since, so running sift from a
 * checkout needs no separate build step. A packaged install ships the build without its sources, and this
 * does nothing there.
 */
export async function ensurePageBuilt(): Promise<void> {
  if (!existsSync(join(ROOT, 'web/src'))) return;
  const built = newest(join(ROOT, '.next/BUILD_ID'));
  if (built > 0 && built >= Math.max(...SOURCES.map((name) => newest(join(ROOT, name))))) return;
  try {
    await spin('Building the dashboard', () => promisify(execFile)('pnpm', ['exec', 'next', 'build'], { cwd: ROOT, env: { ...process.env, ...NO_TELEMETRY } }));
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim().split('\n').slice(-3).join(' ') ?? String(error);
    throw new Error(`The dashboard could not be built (${detail}). Run \`pnpm install\`, then try again.`, { cause: error });
  }
}
