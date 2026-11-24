import { globSync, readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { ui } from '../../src/cli/ui.ts';
import { writeDigest } from '../../src/digest/mail.ts';

/** The name in lowercase as a word of its own, not part of a command, a path, an address or a variable, nor the verb. */
const LOWERCASE_NAME = /(?<![\w/.@~$-])mild(?![\w/.@-])/;
/** What keeps its own spelling in Markdown: code, a picture's alt text (a picture of a command), a link's target, an address. */
const CODE = /`[^`]*`|!\[[^\]]*\]|\]\([^)]*\)|https?:\/\/\S+/g;

/** A Markdown file's prose, line by line, with fenced blocks and code left out. */
function prose(file: string): [number, string][] {
  let fenced = false;
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i): [number, string][] => {
      if (line.trimStart().startsWith('```')) fenced = !fenced;
      return fenced || line.trimStart().startsWith('```') ? [] : [[i + 1, line.replace(CODE, ' ')]];
    });
}

describe('the name', () => {
  it('is Mild in the docs, but in code', () => {
    const files = globSync(['*.md', 'docs/**/*.md', '.claude/skills/**/*.md']);
    expect(files.length).toBeGreaterThan(10);
    const lower = files.flatMap((file) => prose(file).flatMap(([n, line]) => (LOWERCASE_NAME.test(line) ? [`${file}:${n}`] : [])));
    expect(lower).toEqual([]);
  });

  it('is Mild in a digest, but in its wordmark', () => {
    const mail = writeDigest({
      label: { id: 'notifications', name: 'Notifications', gmailLabel: 'mild/notifications' },
      mailbox: 'me@example.org',
      since: 0,
      until: 3_600_000,
      entries: [{ mailbox: 'me@example.org', id: 'a1', from: { name: 'Builds', address: 'builds@example.org' }, subject: 'Run passed', receivedAt: 60_000 }],
      highlights: [],
      timeZone: 'UTC',
      dashboard: 'https://mild.example.com',
    });
    expect(mail.html).toContain('>mild</a>');
    expect(mail.html.replace('>mild</a>', '').replace(/<[^>]*>/g, ' ')).not.toMatch(LOWERCASE_NAME);
    expect(mail.text.replace(/https?:\/\/\S+/g, ' ')).not.toMatch(LOWERCASE_NAME);
  });

  it('heads each command as its wordmark', () => {
    let printed = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((text) => ((printed += String(text)), true));
    ui.heading('status', '~/.config/mild');
    write.mockRestore();
    expect(stripVTControlCharacters(printed)).toContain(' mild  status');
  });
});
