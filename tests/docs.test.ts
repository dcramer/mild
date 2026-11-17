import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCS = globSync(['*.md', 'docs/**/*.md', '.claude/skills/**/*.md']);
// What is built or installed, never committed: named in .gitignore without a slash or wildcard.
const BUILT = new Set(
  readFileSync('.gitignore', 'utf8')
    .split('\n')
    .map((line) => line.trim().replace(/\/$/, ''))
    .filter((line) => line && !line.startsWith('#') && !/[/*]/.test(line)),
);

/** Repository paths a document names: a code span that is one path from the root, or a relative link. */
function named(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const spans = [...text.matchAll(/`((?:src|web|tests|docs|api|\.claude)\/[\w./-]*)`/g)].map((m) => m[1]!.replace(/:\d+$/, ''));
  const links = [...text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)]
    .map((m) => m[1]!)
    .filter((target) => !/^[a-z]+:/.test(target))
    .map((target) => normalize(join(dirname(file), target)));
  return [...spans, ...links];
}

describe('the docs', () => {
  it('name only files and directories that exist', () => {
    expect(DOCS.length).toBeGreaterThan(10);
    const gone = DOCS.flatMap((file) =>
      named(file)
        .filter((path) => !existsSync(path) && !existsSync(`${path}.ts`) && !path.split('/').some((part) => BUILT.has(part)))
        .map((path) => `${file}: ${path}`),
    );
    expect(gone, 'a moved or removed file is still named here: point at where it is now').toEqual([]);
  });
});
