import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Module state that holds between calls, allowed because any instance computes the same: a cache, not a
 * record of what happened (docs/RUNTIME.md).
 */
const CACHES: Record<string, string[]> = {
  // Keys derived from SIFT_KEY.
  'src/secrets.ts': ['derived'],
};

describe('nothing is kept in module memory between calls', () => {
  it('outside the `sift run` adapter, no module holds a variable or an empty collection to fill', () => {
    const unexpected: string[] = [];
    for (const file of globSync('src/**/*.ts')) {
      // The CLI is the adapter for one long-lived process: its terminal and its own caches.
      if (file.startsWith('src/cli/')) continue;
      const held = /^(?:export )?(?:let|var) (\w+)|^(?:export )?const (\w+) = new (?:Map|Set|WeakMap|WeakSet)(?:<[^\n]*>)?\(\)/gm;
      for (const match of readFileSync(file, 'utf8').matchAll(held)) {
        const name = match[1] ?? match[2]!;
        if (!CACHES[file]?.includes(name)) unexpected.push(`${file}: ${name}`);
      }
    }
    expect(unexpected).toEqual([]);
  });
});
