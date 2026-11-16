import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { paint, ui } from '../ui.ts';
import { ROOT } from '../web-build.ts';

/**
 * For working on sift itself: `sift run`, restarted whenever the server's code changes, beside a build
 * of the page that is redone whenever the page's code changes. The page reloads by itself on either.
 * Arguments are passed on to `run`.
 */
export async function dev(args: string[]): Promise<void> {
  if (!existsSync(join(ROOT, 'web/src'))) throw new Error('`sift dev` needs a checkout of the source. Use `sift run` here.');
  ui.heading('dev', 'restarts on server changes, reloads on page changes');
  ui.blank();

  const server = spawn(
    process.execPath,
    ['--watch', '--watch-preserve-output', '--disable-warning=ExperimentalWarning', join(ROOT, 'src/cli/main.ts'), 'run', '--dev', ...args],
    { stdio: 'inherit' },
  );
  const page = spawn('pnpm', ['--filter', 'sift-web', 'exec', 'vite', 'build', '--watch', '--logLevel', 'warn'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // The page build is quiet unless it has something to say, which is then an error or a warning.
  for (const stream of [page.stdout, page.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line.trim() !== '') ui.plain(`${paint.dim('page')}  ${line}`);
    });
  }

  const stop = () => {
    server.kill('SIGTERM');
    page.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  // Either one ending ends both: a dev session with half of it gone is only confusing.
  await new Promise<void>((resolve) => {
    let left = 2;
    const ended = () => {
      stop();
      if (--left === 0) resolve();
    };
    server.once('exit', ended);
    page.once('exit', ended);
  });
}
