import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOWNLOADS, FRAMES, READS, WRITES } from '../../src/dashboard/api/index.ts';

const DIR = 'src/dashboard/api/routes/';
const KINDS = { get: READS, post: WRITES, frame: FRAMES, download: DOWNLOADS } as const;

describe('the API routes', () => {
  it('are one module each, at the path it serves, named for its kind, and every one registered once', async () => {
    const files = globSync(`${DIR}**/*.ts`).toSorted();
    const registered = [...READS, ...WRITES, ...FRAMES, ...DOWNLOADS];
    expect(files).toHaveLength(registered.length);
    for (const file of files) {
      const [, path, kind] = /^src\/dashboard\/api\/routes\/(.+)\/(get|post|frame|download)\.ts$/.exec(file) ?? [];
      expect(kind, `${file} is named get.ts, post.ts, frame.ts or download.ts`).toBeDefined();
      const route = ((await import(/* @vite-ignore */ pathToFileURL(resolve(file)).href)) as { default: { path: string } }).default;
      expect(route.path, file).toBe(`/api/${path}`);
      expect(KINDS[kind as keyof typeof KINDS], file).toContain(route);
      expect(
        registered.filter((other) => other === route),
        file,
      ).toHaveLength(1);
    }
  });

  it('are asked for by the page only through endpoints.ts, which finds a thing by `account` and leaves `?mailbox=` to the switcher', () => {
    const code = (file: string) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
    expect(globSync('web/src/**/*.{ts,tsx}').filter((file) => code(file).some((line) => /['"`]\/api\//.test(line)))).toEqual([
      'web/src/lib/api/client.ts',
      'web/src/lib/api/endpoints.ts',
    ]);
    // Narrowing a read of one message to its mailbox narrowed what came beside it: a digest's list lost the other mailboxes' mail.
    expect(code('web/src/lib/api/endpoints.ts').filter((line) => /[{(,]\s*mailbox\s*[,:})]|['"]mailbox['"]|mailbox=/.test(line))).toEqual([]);
  });
});
