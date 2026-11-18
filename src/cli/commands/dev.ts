import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../next.ts';
import { run } from './run.ts';

/**
 * For working on Sift itself: `sift run` with `next dev`, which reloads what changes, the server's code under
 * `src/` and `app/` included. Arguments are passed on to `run`.
 */
export async function dev(args: string[]): Promise<void> {
  if (!existsSync(join(ROOT, 'web/src'))) throw new Error('`sift dev` needs a checkout of the source. Use `sift run` here.');
  await run(args, true);
}
