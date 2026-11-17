import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The repository's own files, committed or not yet, without what is built or installed. */
const OWN = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file && existsSync(file));
const CODE = OWN.filter((file) => /\.(ts|tsx|js|mjs|cjs)$/.test(file));

describe('Next.js answers nothing that skips the API', () => {
  it('holds no Server Action, which would be an endpoint outside the session, Host and same-origin checks', () => {
    const actions = CODE.filter((file) => /['"]use server['"]/.test(readFileSync(file, 'utf8')));
    expect(actions).toEqual([]);
  });

  it('has the frame, the page, and the route handlers that hand each request to Sift, and nothing else in app/', () => {
    // Workflow writes its own routes into app/.well-known/workflow at build, which .gitignore leaves out of OWN.
    expect(OWN.filter((file) => file.startsWith('app/')).toSorted()).toEqual([
      'app/[[...path]]/page.tsx',
      'app/api/[...path]/route.ts',
      'app/api/cron/route.ts',
      'app/auth/[...path]/route.ts',
      'app/layout.tsx',
    ]);
  });
});

it('names no NEXT_PUBLIC_ variable, which Next.js would write into the JavaScript it sends the browser', () => {
  const PUBLIC = /NEXT_PUBLIC_/;
  const named = OWN.filter((file) => !file.endsWith('.md') && file !== 'tests/next.test.ts' && PUBLIC.test(readFileSync(file, 'utf8')));
  expect(named).toEqual([]);
});
