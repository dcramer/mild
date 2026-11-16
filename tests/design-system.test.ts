import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

// docs/DESIGN.md as checks. Screens kept drifting from the system one view at a time (grey fills, a stray
// shadow, red and yellow written by hand, type set by eye), so what a screen may write is decided here.

const WEB = new URL('../web/src/', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const ALL = sources(WEB);
const SYSTEM = new Set(ALL.filter((path) => relative(WEB, path).startsWith('system/')));
// The specimen page shows the tokens themselves, so it may name them.
const SCREENS = ALL.filter((path) => !SYSTEM.has(path) && relative(WEB, path) !== 'views/system.tsx');

interface Word {
  file: string;
  line: number;
  word: string;
}

/** Every word of every string literal: class names live in strings, and the page's own text mostly does not. */
function words(path: string): Word[] {
  const source = readFileSync(path, 'utf8');
  const found: Word[] = [];
  for (const match of source.matchAll(/"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|`((?:\\.|[^`\\])*)`/g)) {
    const line = source.slice(0, match.index).split('\n').length;
    for (const word of (match[1] ?? match[2] ?? match[3] ?? '').split(/\s+/)) {
      if (word) found.push({ file: relative(WEB, path), line, word });
    }
  }
  return found;
}

/** A class name without its variants (`md:`, `hover:`, `aria-[current=page]:`) or `!` and `-`. */
function utility(word: string): string {
  return (word.split(/:(?![^[]*\])/).pop() ?? word).replace(/^[!-]+/, '');
}

function check(paths: string[], rules: [RegExp, string][]): string[] {
  const failures: string[] = [];
  for (const path of paths) {
    for (const { file, line, word } of words(path)) {
      if (word.startsWith('--')) continue; // a command's flag in the page's text, never a class
      const name = utility(word);
      for (const [pattern, use] of rules) {
        if (pattern.test(name)) failures.push(`web/src/${file}:${line} \`${word}\`: ${use}`);
      }
    }
  }
  return failures;
}

const CHROME = 'fills, frames, corners and shadows belong to parts in web/src/system. Use or extend a part (and show it at /system).';

describe('screens style nothing themselves', () => {
  test('no fills, frames, corners, shadows, red, yellow or raw colours outside web/src/system', () => {
    const failures = check(SCREENS, [
      [/^(bg|border|ring|shadow|rounded|outline|divide)(-|$)/, CHROME],
      [/^(fill|stroke|from|via|to)-/, CHROME],
      [/^text-destructive/, 'red is a failure: use `Failure` (or `Note tone="failure"`).'],
      [/^(text-highlight|hl$)/, 'yellow comes only from a part: `Button variant="mark"`, a `look` tone, `Highlight`.'],
      [/^\[[\w-]+:.+\]$/, CHROME],
      [/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$|^(rgb|rgba|hsl|oklch|oklab)\(/i, 'colours are tokens in web/src/index.css, used by parts.'],
    ]);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('no inline style outside web/src/system', () => {
    const failures = SCREENS.filter((path) => /\bstyle=\{/.test(readFileSync(path, 'utf8'))).map(
      (path) => `web/src/${relative(WEB, path)}: an inline style is only for a part's value computed from data, in web/src/system.`,
    );
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
