import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// sift classifies mail; it does not sort it, and it is on or off, not observing. 8b214f2 renamed both on
// the page and in the docs, and comments, AGENTS.md and compose.yaml kept saying sorts, for the next
// change to copy. A word quoted on its own ("sorting") is a mention, not a use.
const BANNED = [
  { pattern: /(?<!\w)sort(s|ed|ing)?\b(?!\()/gi, instead: 'classify, label, decide, judge; or order, for a list' },
  { pattern: /(?<!\w)observ(e|es|ed|ing)\b(?!\()/gi, instead: 'off, or suggesting' },
];

const TEXT = /\.(ts|tsx|js|md|css|html|json|ya?ml|toml|sh)$/;

test('nothing calls classifying mail sorting it', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => TEXT.test(file) && file !== 'pnpm-lock.yaml' && file !== 'tests/vocabulary.test.ts');
  const found: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const unquoted = line.replaceAll(/"[\w-]+"/g, '');
        for (const { pattern, instead } of BANNED)
          for (const match of unquoted.matchAll(pattern)) found.push(`${file}:${index + 1} "${match[0]}": say ${instead}`);
      });
  }
  expect(found).toEqual([]);
});
