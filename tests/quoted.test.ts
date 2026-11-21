import { describe, expect, it } from 'vitest';
import { splitQuoted } from '../web/src/lib/quoted.ts';

describe('the history a reply quotes, in its text', () => {
  it('is folded where it ends the message, from the line that says who wrote it', () => {
    expect(splitQuoted('See you then.\n\nOn Mon, Nov 2, 2026 at 9:14 AM Me <me@example.org> wrote:\n\n> Lunch?\n> Thursday?\n')).toEqual({
      own: 'See you then.',
      quoted: 'On Mon, Nov 2, 2026 at 9:14 AM Me <me@example.org> wrote:\n\n> Lunch?\n> Thursday?',
    });
    // Gmail wraps a long line that says who wrote it.
    expect(splitQuoted('Yes.\n\nOn Mon, Nov 2, 2026 at 9:14 AM Someone With A Long Name <me@example.org>\nwrote:\n> Lunch?').own).toBe('Yes.');
    expect(splitQuoted('Yes.\n> Lunch?').quoted).toBe('> Lunch?');
  });

  it('is folded from Outlook’s head of the message it answers, which is not quoted', () => {
    const outlook =
      'Works for me.\n\n________________________________\nFrom: Ada Lovelace <ada@example.org>\nSent: Monday, November 2, 2026 9:14 AM\nSubject: Offsite\n\nShall we meet at the lake?';
    expect(splitQuoted(outlook).own).toBe('Works for me.');
    expect(splitQuoted('Works for me.\n\n-----Original Message-----\nFrom: Ada\nShall we?').own).toBe('Works for me.');
    expect(splitQuoted('Works for me.\n\nFrom: Ada Lovelace <ada@example.org>\nDate: Monday\nShall we?').own).toBe('Works for me.');
  });

  it('stays open where it is all there is to read: a forward, a reply between quoted lines, or nothing but a quote', () => {
    const forward = 'FYI\n\n---------- Forwarded message ---------\nFrom: Ada <ada@example.org>\nDate: Monday\n\nShall we?';
    const between = 'On Mon, Ada wrote:\n> Lunch?\nYes.\n> Thursday?\nNoon.';
    for (const text of [forward, between, '> Lunch?\n> Thursday?', 'No history here.']) expect(splitQuoted(text), text).toEqual({ own: text, quoted: null });
  });
});
