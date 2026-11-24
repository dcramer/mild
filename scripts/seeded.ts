import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { launch } from '../e2e/launch.ts';

/**
 * verify-sift's seed served by its `serve.ts` from `root`'s production build, for a script that drives the page outside
 * the browser tests, seeded with `flags` (seed.ts's). `cookie` is the seeded person's session.
 */
export async function serveSeed(root: string, flags: string[] = []): Promise<{ url: string; cookie: string; stop: () => Promise<void> }> {
  const scripts = join(root, '.claude/skills/verify-sift/scripts');
  const dir = mkdtempSync(join(tmpdir(), 'sift-measure-'));
  const { stdout } = await promisify(execFile)(
    'node',
    ['--disable-warning=ExperimentalWarning', join(scripts, 'seed.ts'), join(dir, 'home'), join(dir, 'google.json'), ...flags],
    { cwd: root },
  );
  const server = await launch(dir, { scripts, env: { MILD_CLOUD: 'false' } });
  return {
    url: server.url,
    cookie: stdout.trim(),
    stop: async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
