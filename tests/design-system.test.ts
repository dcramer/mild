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

describe('one type scale', () => {
  const css = readFileSync(join(WEB, 'index.css'), 'utf8');
  const scale = [...css.matchAll(/^\s*--text-([a-z]+):/gm)].map((match) => `text-${match[1]}`);

  test('a size is a step of the scale in web/src/index.css, never one set by eye', () => {
    const offScale = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `text-${n}xl`)].filter(
      (name) => !scale.includes(name),
    );
    const use = `use ${scale.join(', ')}, or a role class (.statement, .title, .heading, .name, .figure, .slug).`;
    const failures = check(ALL, [
      [/^text-\[[\d.]+(px|rem)\]$/, use],
      [new RegExp(`^(${offScale.join('|')})$`), `not on the scale, so it sets nothing: ${use}`],
    ]);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('nothing is set under 12px', () => {
    const small = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1])).filter((px) => px < 12);
    expect(small, 'docs/DESIGN.md: only labels and stamps go under 15px, and nothing under 12px.').toEqual([]);
  });
});

describe('as little chrome as it takes', () => {
  // What floats over the page is filled so it can cover what is under it. Nothing else is.
  const FLOATING = new Set([
    'dialog.tsx',
    'panel.tsx',
    'menu.tsx',
    'answer-picker.tsx',
    'select.tsx',
    'toast.tsx',
    'hover-card.tsx',
    'nav.tsx',
    'chart.tsx',
    'confirm.tsx',
    'table.tsx',
  ]);

  test('only a part that floats has a surface', () => {
    const grounded = [...SYSTEM].filter((path) => !FLOATING.has(relative(join(WEB, 'system'), path)));
    const failures = check(grounded, [
      [/^bg-(card|popover|background)\b/, 'only what floats (a panel, a dialog, a menu, a toast) is filled; a sheet, a table or a list sits on the page.'],
    ]);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('one shadow: the edge of the sheet beneath', () => {
    const css = readFileSync(join(WEB, 'index.css'), 'utf8');
    const shadows = [...css.matchAll(/box-shadow:\s*([^;]+);/g)]
      .map((match) => match[1])
      .filter((value) => !/^\S+px \S+px 0 0 var\(--edge\)$/.test(value ?? ''));
    expect(shadows, 'docs/DESIGN.md: --edge, hard and offset, on a sheet and what floats. Buttons have none.').toEqual([]);
    const failures = check(ALL, [[/^shadow(-|$)/, 'the one shadow is the .sheet edge in web/src/index.css.']]);
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

describe('yellow means look here', () => {
  test('a highlighted or ink button is never down a list, and a screen has one highlighted button at most', () => {
    const failures: string[] = [];
    for (const path of SCREENS) {
      const source = readFileSync(path, 'utf8');
      const file = `web/src/${relative(WEB, path)}`;
      for (const row of source.matchAll(/<(Tr|RowActions)\b[\s\S]*?<\/\1>/g)) {
        for (const press of row[0].matchAll(/variant="(mark|ink)"/g)) {
          const line = source.slice(0, (row.index ?? 0) + (press.index ?? 0)).split('\n').length;
          failures.push(`${file}:${line} variant="${press[1]}" in a row: a press repeated down a list is quiet.`);
        }
      }
      const marks = [...source.matchAll(/variant="mark"/g)].length;
      if (marks > 1) failures.push(`${file}: ${marks} buttons with variant="mark"; a screen has one thing waiting on the reader at most.`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

test('whatever can be pressed shows the pointer', () => {
  // A choice in a menu or a select is pressed like a button. Only a disabled one keeps the arrow, through a variant.
  const bare = [...SYSTEM].flatMap((path) => words(path)).filter(({ word }) => word === 'cursor-default');
  const failures = bare.map(({ file, line }) => `web/src/${file}:${line} cursor-default: an interactive element takes cursor-pointer (docs/DESIGN.md).`);
  expect(failures, failures.join('\n')).toEqual([]);
});

test('every part is on the specimen page', () => {
  const index = readFileSync(join(WEB, 'system/index.ts'), 'utf8');
  const parts = [...index.matchAll(/export \{([^}]*)\}/g)]
    .flatMap((match) => (match[1] ?? '').split(','))
    .map((name) => name.trim())
    .filter((name) => /^[A-Z]/.test(name));
  // Toaster is mounted once by the app; the specimen page shows toasts through useToast.
  const specimen = readFileSync(join(WEB, 'views/system.tsx'), 'utf8');
  const missing = parts.filter((name) => name !== 'Toaster' && !new RegExp(`<${name}\\b`).test(specimen));
  expect(missing, 'add each to web/src/views/system.tsx, in its states (docs/DESIGN.md)').toEqual([]);
});

test('keys are for working through a list, and screens bind none of their own', () => {
  // Keys kept spreading to every list and step because the parts allowed them. Only these lists are worked through one item after another.
  const LISTS = new Set(['views/suggestions.tsx', 'components/mail-log.tsx']);
  const failures = SCREENS.flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const file = relative(WEB, path);
    return [
      ...(/<Table keys\b/.test(source) && !LISTS.has(file)
        ? [`web/src/${file}: <Table keys> is only for Suggestions and Activity (docs/DESIGN.md, Keys).`]
        : []),
      ...(/\bshortcut=|\buseShortcut\(/.test(source) ? [`web/src/${file}: a screen binds no key; keys belong to the parts (docs/DESIGN.md, Keys).`] : []),
    ];
  });
  expect(failures, failures.join('\n')).toEqual([]);
});
