import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

/** verify-sift's scripts in this checkout. */
export const SCRIPTS = resolve(import.meta.dirname, '../.claude/skills/verify-sift/scripts');

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? done(address.port) : fail(new Error('no port'))));
    });
  });

const withTimeout = <T>(work: Promise<T>, ms: number, what: string) =>
  Promise.race([work, new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`${what} in ${ms / 1000}s`)), ms).unref())]);

/**
 * verify-sift's `serve.ts` from `scripts` (the app, reaching the fake Google and a stand-in model) on the seeded home in
 * `dir`, on a free port, once it says it is running. `args` and `env` are given to it as well.
 */
export async function launch(
  dir: string,
  { scripts = SCRIPTS, args = [], env = {} }: { scripts?: string; args?: string[]; env?: Record<string, string> } = {},
) {
  // Another process can take the free port before the server binds it; then it tries another.
  const serve = async (tries: number): Promise<{ port: number; child: ChildProcess }> => {
    const port = await freePort();
    const child = spawn(
      'node',
      ['--disable-warning=ExperimentalWarning', join(scripts, 'serve.ts'), join(dir, 'home'), String(port), join(dir, 'google.json'), ...args],
      {
        cwd: resolve(scripts, '../../../..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        // A group of its own, with the Next.js server it starts, to end together.
        detached: true,
      },
    );
    let log = '';
    const started = await new Promise<boolean>((ready, fail) => {
      const read = (chunk: Buffer) => {
        log += chunk.toString();
        if (log.includes('Mild is running on the seeded home')) ready(true);
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.once('exit', (code) => (log.includes('already in use') && tries > 1 ? ready(false) : fail(new Error(`serve.ts exited ${code}:\n${log}`))));
    });
    return started ? { port, child } : serve(tries - 1);
  };
  const { port, child } = await withTimeout(serve(3), 30_000, 'serve.ts did not start');
  return {
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      const exited = new Promise((done) => child.once('exit', done));
      // Not Next.js's own stop, which waits for a run's step under way: one may wait on Gmail for good (`listing`).
      process.kill(-child.pid!, 'SIGKILL');
      await exited;
    },
  };
}
