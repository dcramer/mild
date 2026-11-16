import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAMES, READS, WRITES } from '../src/dashboard/api/index.ts';

const DIR = 'src/dashboard/api/routes/';
const KINDS = { get: READS, post: WRITES, frame: FRAMES } as const;

describe('the API routes', () => {
  it('are one module each, at the path it serves, named for its kind, and every one registered once', async () => {
    const files = globSync(`${DIR}**/*.ts`).toSorted();
    const registered = [...READS, ...WRITES, ...FRAMES];
    expect(files).toHaveLength(registered.length);
    for (const file of files) {
      const [, path, kind] = /^src\/dashboard\/api\/routes\/(.+)\/(get|post|frame)\.ts$/.exec(file) ?? [];
      expect(kind, `${file} is named get.ts, post.ts or frame.ts`).toBeDefined();
      const route = ((await import(/* @vite-ignore */ pathToFileURL(resolve(file)).href)) as { default: { path: string } }).default;
      expect(route.path, file).toBe(`/api/${path}`);
      expect(KINDS[kind as keyof typeof KINDS], file).toContain(route);
      expect(
        registered.filter((other) => other === route),
        file,
      ).toHaveLength(1);
    }
  });
});
