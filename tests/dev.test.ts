import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../src/cli/page-build.ts';

describe('the checkout root', () => {
  it('is where `sift dev` finds the page sources and the CLI', () => {
    expect(existsSync(join(ROOT, 'web/src'))).toBe(true);
    expect(existsSync(join(ROOT, 'src/cli/main.ts'))).toBe(true);
  });
});
