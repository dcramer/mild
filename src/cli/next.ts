import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fromHere } from './network.ts';
import { spin } from './ui.ts';

/** The checkout, or in the image the folder Next.js's standalone server was copied to. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Next.js reports how it is used to Vercel unless told not to; Mild sends nothing it is not asked to. */
const NO_TELEMETRY = { NEXT_TELEMETRY_DISABLED: '1' };

const NEXT = join(ROOT, 'node_modules/next/dist/bin/next');
/** All a packaged install ships of Next.js: `output: 'standalone'` (next.config.js), without the sources to build from. */
const STANDALONE = join(ROOT, 'server.js');

/**
 * From a checkout, the page is built before it is served, every time: Next.js's cache decides what changed, which
 * takes seconds when little did, and nothing stale is ever served. A packaged install ships its build.
 */
export async function buildPage(): Promise<void> {
  if (!existsSync(join(ROOT, 'app'))) return;
  try {
    await spin('Building the dashboard', () => promisify(execFile)(process.execPath, [NEXT, 'build'], { cwd: ROOT, env: { ...process.env, ...NO_TELEMETRY } }));
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim().split('\n').slice(-3).join(' ') ?? String(error);
    throw new Error(`The dashboard could not be built (${detail}). Run \`pnpm install\`, then try again.`, { cause: error });
  }
}

const free = (port: number, hostname: string) =>
  new Promise<boolean>((resolve, reject) => {
    const probe = createServer()
      .once('error', (error: NodeJS.ErrnoException) => (error.code === 'EADDRINUSE' ? resolve(false) : reject(error)))
      .listen(port, hostname, () => probe.close(() => resolve(true)));
  });

export interface NextServer {
  /** Where this machine reaches it. */
  url: string;
  /** Resolves with the exit code once the server has stopped, for whatever reason. */
  exited: Promise<number | null>;
  /** Next.js's own stop: no new requests, the ones under way finished (a run's step among them), then exit. */
  stop: () => Promise<void>;
}

/**
 * Next.js on one address, the supported way: `next start` from a checkout, `next dev` with `dev`, or the standalone
 * server in a packaged install. `env` is added to this process's. What it prints once it answers goes to `print`;
 * its own banner before then does not, since Mild says where it is itself.
 */
export async function startNext(options: {
  dev: boolean;
  port: number;
  hostname: string;
  env: NodeJS.ProcessEnv;
  inUse: string;
  print: (line: string) => void;
}): Promise<NextServer> {
  const { port, hostname } = options;
  // Next.js would say so in its own words, and exit.
  if (!(await free(port, hostname))) throw new Error(options.inUse);
  const standalone = !options.dev && existsSync(STANDALONE);
  const args = standalone ? [STANDALONE] : [NEXT, options.dev ? 'dev' : 'start', '--port', String(port), '--hostname', hostname];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...NO_TELEMETRY, ...options.env, PORT: String(port), HOSTNAME: hostname },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  let answering = false;
  const before: string[] = [];
  for (const stream of [child.stdout, child.stderr])
    createInterface({ input: stream }).on('line', (line) => (answering ? options.print(line) : before.push(line)));

  const url = fromHere(hostname, port);
  const deadline = Date.now() + 120_000;
  for (;;) {
    const answer = await Promise.race([
      fetch(`${url}/api/session`).then(
        () => 'up' as const,
        () => 'not yet' as const,
      ),
      exited.then(() => 'gone' as const),
    ]);
    if (answer === 'up') break;
    if (answer === 'gone' || Date.now() > deadline) {
      child.kill();
      throw new Error(`The dashboard did not start:\n${before.slice(-20).join('\n')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  answering = true;
  return {
    url,
    exited,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await exited;
    },
  };
}
