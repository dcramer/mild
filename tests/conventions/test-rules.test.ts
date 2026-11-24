import { globSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

/** Each line of `files` that matches one of `rules`, as `file:line: what to do instead`. */
function breaches(files: string[], rules: [RegExp, string][]): string[] {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, at) => rules.filter(([pattern]) => pattern.test(line)).map(([, use]) => `${file}:${at + 1}: ${use}`)),
  );
}

// Each of these passed on a quiet machine and failed now and then on a busy one, or on someone else's.
test('a browser test waits for what it checks, and never for a set time', () => {
  const found = breaches(globSync('e2e/**/*.spec.ts'), [
    [/page\.url\(\)/, 'the address changes after a press returns: query(page), param(page, name), path(page) or expect(page).toHaveURL'],
    [/\.boundingBox\(/, 'a layer may still be sliding: boxOf(locator)'],
    [/\.hover\(/, 'what is under the pointer may still move: pointAt(locator)'],
    [/waitForTimeout|setTimeout/, 'wait for the state itself: a web-first assertion or expect.poll'],
    [/route\.fetch\(/, 'forward(route), which sends it again when the server closed the connection under it'],
  ]);
  expect(found, found.join('\n')).toEqual([]);
});

test("a unit test reads nothing of the machine it runs on, and changes the environment only through vitest's stubs", () => {
  const found = breaches(
    globSync('tests/**/*.ts').filter((file) => file !== 'tests/setup.ts' && file !== 'tests/conventions/test-rules.test.ts'),
    [
      [/process\.env\[[^\]]+\]\s*=[^=]|delete process\.env|Object\.assign\(process\.env/, 'vi.stubEnv, which is undone after the test'],
      [/networkInterfaces\(\)|hostname\(\)/, 'a made-up machine: mock node:os, as tests/network.test.ts does'],
    ],
  );
  expect(found, found.join('\n')).toEqual([]);
});
