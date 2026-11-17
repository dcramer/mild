import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { ui } from '../ui.ts';
import { ROOT } from '../page-build.ts';

/**
 * For working on sift itself: `sift run`, restarted whenever the server's code changes, with the page from
 * Next.js's development server, which updates it in place as its code changes. Arguments are passed on to `run`.
 */
export async function dev(args: string[]): Promise<void> {
  if (!existsSync(join(ROOT, 'web/src'))) throw new Error('`sift dev` needs a checkout of the source. Use `sift run` here.');
  ui.heading('dev', 'restarts on server changes, updates the page as it changes');
  ui.blank();

  // Not `node --watch`: Next.js takes the message channel it opens to the process it runs for one of its own workers'.
  let server: ChildProcess | undefined;
  let stopping = false;
  const start = () => {
    server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'src/cli/main.ts'), 'run', '--dev', ...args], { stdio: 'inherit' });
  };
  const restart = () => {
    const old = server;
    if (!old || old.exitCode !== null) return start();
    old.once('exit', () => !stopping && start());
    old.kill('SIGTERM');
  };
  // Only the server's code restarts it: the page's is the development server's to follow. A save is often several writes.
  let pending: NodeJS.Timeout | undefined;
  const watcher = watch(join(ROOT, 'src'), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(restart, 100);
  });
  start();
  await new Promise<void>((resolve) => {
    const stop = () => {
      stopping = true;
      watcher.close();
      clearTimeout(pending);
      if (!server || server.exitCode !== null) return resolve();
      server.once('exit', () => resolve());
      server.kill('SIGTERM');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
