import { homedir } from 'node:os';
import { emitKeypressEvents } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import pc from 'picocolors';
import { ask, readLine, suspendReader } from './terminal.ts';

/**
 * How sift looks in a terminal. The same language as the dashboard: plain ink, quiet secondary
 * text, and one colour, a yellow highlighter, kept for the name and for what needs the reader.
 * Red is only for failures. Colour and motion switch off by themselves when output is not a
 * terminal (picocolors honours NO_COLOR and pipes), so everything here still reads as plain text.
 */
export const interactive = process.stdout.isTTY && process.stdin.isTTY;

// Rows written since `mark()`, so a finished section can be folded away. Counts wrapped rows too.
let tracking = false;
let rows = 0;
const rowsOf = (text: string) => {
  const width = process.stdout.columns || 80;
  return text.split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(stripVTControlCharacters(part).length / width)), 0);
};
const out = (text: string) => process.stdout.write(text);
const line = (text = '') => {
  if (tracking) rows += rowsOf(text);
  out(`${text}\n`);
};

/** A path with the home directory written as ~. */
export const tilde = (path: string) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path);

export const paint = {
  /** The highlighter. */
  mark: (text: string) => pc.bgYellow(pc.black(text)),
  dim: pc.dim,
  bold: pc.bold,
  /** Something to type. */
  cmd: (text: string) => pc.bold(text),
  path: (path: string) => pc.underline(tilde(path)),
  bad: pc.red,
};

const SYMBOL = { ok: pc.dim('✓'), skip: pc.dim('–'), warn: pc.yellow('!'), fail: pc.red('✗'), pointer: pc.yellow('›') };
/** Headings and status symbols sit at PAD; everything you read sits at TEXT, so symbols hang in a gutter. */
const PAD = '  ';
const TEXT = '    ';

/** `sift` in highlighter, then what this screen is. */
export function heading(title: string, detail?: string): void {
  line();
  line(`${PAD}${paint.mark(' sift ')} ${pc.bold(title)}${detail ? `  ${pc.dim(detail)}` : ''}`);
  line();
}

export const say = {
  ok: (text: string) => line(`${PAD}${SYMBOL.ok} ${text}`),
  skip: (text: string) => line(`${PAD}${SYMBOL.skip} ${pc.dim(text)}`),
  /** Something the reader should act on. */
  warn: (text: string) => line(`${PAD}${SYMBOL.warn} ${text}`),
  fail: (text: string) => line(`${PAD}${SYMBOL.fail} ${text}`),
  info: (text: string) => line(`${TEXT}${pc.dim(text)}`),
  plain: (text: string) => line(`${TEXT}${text}`),
  blank: () => line(),
};

/** A numbered section of a longer flow. */
export function step(n: number, total: number, title: string): void {
  line();
  line(`${PAD}${pc.bold(title)}  ${pc.dim(`${n} of ${total}`)}`);
}

/** Start of a section that `collapse` can later fold into one line. */
export function mark(): void {
  tracking = true;
  rows = 0;
}

/** Fold everything since `mark()` into a single done line. In a pipe nothing is erased; the line is just added. */
export function collapse(summary: string): void {
  if (interactive && tracking && rows > 0) out(`\u001B[${rows}A\u001B[0J`);
  tracking = false;
  say.ok(summary);
}

/** Label and value pairs, aligned, with quiet labels. */
export function fields(pairs: readonly (readonly [string, string])[]): void {
  const width = Math.max(...pairs.map(([label]) => label.length));
  for (const [label, value] of pairs) line(`${TEXT}${pc.dim(label.padEnd(width))}  ${value}`);
}

// Width as shown, ignoring colour codes.
const shown = (text: string) => stripVTControlCharacters(text).length;
const padTo = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - shown(text)));

/** An aligned table with a quiet header row. */
export function table(headers: readonly string[], body: readonly (readonly string[])[]): void {
  const widths = headers.map((header, column) => Math.max(header.length, ...body.map((row) => shown(row[column] ?? ''))));
  line(`${TEXT}${headers.map((header, column) => pc.dim(padTo(header, widths[column] ?? 0))).join('  ')}`.trimEnd());
  for (const row of body) line(`${TEXT}${row.map((cell, column) => padTo(cell, widths[column] ?? 0)).join('  ')}`.trimEnd());
}

/** What sift does with a kind of mail, weighted like the dashboard's badges. */
export function disposition(value: string): string {
  if (value === 'review') return paint.mark(` ${value} `);
  if (value === 'spam') return pc.inverse(` ${value} `);
  if (value === 'archive') return value;
  return pc.dim(value);
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Show a small spinner while `work` runs. In a pipe it just runs the work. */
export async function spin<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (!interactive) return work();
  let frame = 0;
  const draw = () => out(`\r\u001B[2K${PAD}${pc.dim(FRAMES[frame++ % FRAMES.length] ?? '')} ${pc.dim(label)}`);
  out('\u001B[?25l');
  draw();
  const timer = setInterval(draw, 80);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    out('\r\u001B[2K\u001B[?25h');
  }
}

export interface Option<T> {
  label: string;
  hint?: string;
  value: T;
}

const VISIBLE = 9;

/**
 * Choose one option. In a terminal: arrow keys (or j/k) and Enter. In a pipe: a numbered list and a
 * typed number. Returns the chosen value.
 */
export async function select<T>(question: string, options: readonly Option<T>[]): Promise<T> {
  const first = options[0];
  if (first === undefined) throw new Error('select needs at least one option');
  if (!interactive) {
    line(`${TEXT}${question}`);
    options.forEach((option, index) => line(`${TEXT}${index + 1}. ${option.label}${option.hint ? ` (${option.hint})` : ''}`));
    for (;;) {
      const chosen = options[Number(await ask(`${TEXT}Choose 1-${options.length}:`)) - 1];
      if (chosen) return chosen.value;
    }
  }

  // Raw key handling and the line reader cannot share the input, so the reader steps aside.
  suspendReader();
  const input = process.stdin;
  let at = 0;
  let drawn = 0;
  const render = () => {
    const top = Math.min(Math.max(0, at - Math.floor(VISIBLE / 2)), Math.max(0, options.length - VISIBLE));
    const menu = [`${TEXT}${question}`];
    options.slice(top, top + VISIBLE).forEach((option, offset) => {
      const active = top + offset === at;
      const hint = option.hint ? `  ${pc.dim(option.hint)}` : '';
      menu.push(active ? `${PAD}${SYMBOL.pointer} ${pc.bold(option.label)}${hint}` : `${TEXT}${pc.dim(option.label)}`);
    });
    if (options.length > VISIBLE) menu.push(`${TEXT}${pc.dim(`${at + 1} of ${options.length}`)}`);
    if (drawn > 0) out(`\u001B[${drawn}A`);
    out(`\u001B[0J${menu.join('\n')}\n`);
    drawn = menu.length;
  };

  return new Promise<T>((resolve) => {
    const finish = (chosen: Option<T>) => {
      input.off('keypress', onKey);
      input.setRawMode(false);
      input.pause();
      // Collapse the menu to one line that records the answer.
      out(`\u001B[${drawn}A\u001B[0J\u001B[?25h`);
      line(`${TEXT}${pc.dim(question)} ${chosen.label}`);
      resolve(chosen.value);
    };
    const onKey = (_text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        input.setRawMode(false);
        out('\u001B[?25h\n');
        process.exit(130);
      }
      if (key.name === 'up' || key.name === 'k') at = (at - 1 + options.length) % options.length;
      else if (key.name === 'down' || key.name === 'j') at = (at + 1) % options.length;
      else if (key.name === 'return') return finish(options[at] ?? first);
      else return;
      render();
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on('keypress', onKey);
    out('\u001B[?25l');
    render();
  });
}

/** Ask for a line of text. An empty answer is allowed. */
export function text(question: string, signal?: AbortSignal): Promise<string> {
  return ask(`${TEXT}${question}`, signal);
}

/**
 * Wait for the reader to do something elsewhere and come back. Returns false if they chose to skip.
 */
export async function pause(hint = 'Enter when done, s to stop'): Promise<boolean> {
  const answer = await ask(`${TEXT}${pc.dim(`${hint}:`)}`);
  if (tracking) rows += 1;
  return !/^s(kip)?$/i.test(answer);
}

/**
 * Read pasted JSON without showing it, since it holds a secret. It may arrive as one line or many:
 * reading stops when it parses, or at an empty line. Returns what was entered, trimmed.
 */
export async function pasteJson(question: string): Promise<string> {
  if (!interactive) {
    let pasted = await ask(`${TEXT}${question}`);
    while (pasted.startsWith('{') && !parses(pasted)) {
      const more = await readLine();
      if (more === null || more.trim() === '') break;
      pasted += `\n${more}`;
    }
    return pasted.trim();
  }

  // Key-by-key, so the terminal does not echo what is pasted.
  suspendReader();
  const input = process.stdin;
  out(`${TEXT}${question} `);
  const pasted = await new Promise<string>((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') {
          input.setRawMode(false);
          out('\n');
          process.exit(130);
        }
        if (ch === '\u007F' || ch === '\b') buffer = buffer.slice(0, -1);
        else buffer += ch === '\r' ? '\n' : ch;
      }
      if (!buffer.includes('\n')) return;
      const entered = buffer.trim();
      if (entered.startsWith('{') && !parses(entered) && !buffer.endsWith('\n\n')) return;
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      resolve(entered);
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
  out(`${pc.dim(pasted.startsWith('{') ? 'received, not shown' : pasted)}\n`);
  if (tracking) rows += 1;
  return pasted;
}

function parses(json: string): boolean {
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

/** A prompt that stays open while something else may answer first. Whoever finishes it starts a new line. */
export function waiting(question: string): void {
  out(`${TEXT}${question} `);
}

/** A URL the reader has to open, set apart so it is easy to find and copy. */
export function link(url: string): void {
  line(`${TEXT}${pc.underline(url)}`);
}

/** Everything a command needs to talk to the person at the terminal. Tests supply their own. */
export interface Ui {
  heading: (title: string, detail?: string) => void;
  step: (n: number, total: number, title: string) => void;
  ok: (text: string) => void;
  skip: (text: string) => void;
  warn: (text: string) => void;
  fail: (text: string) => void;
  info: (text: string) => void;
  plain: (text: string) => void;
  blank: () => void;
  link: (url: string) => void;
  waiting: (question: string) => void;
  fields: (rows: readonly (readonly [string, string])[]) => void;
  table: (headers: readonly string[], rows: readonly (readonly string[])[]) => void;
  select: <T>(question: string, options: readonly Option<T>[]) => Promise<T>;
  text: (question: string, signal?: AbortSignal) => Promise<string>;
  /** Wait for the reader to finish a task elsewhere. False if they chose to skip. */
  pause: (hint?: string) => Promise<boolean>;
  /** Start a section that `collapse` folds into one done line once it is finished. */
  mark: () => void;
  collapse: (summary: string) => void;
  pasteJson: (question: string) => Promise<string>;
  spin: <T>(label: string, work: () => Promise<T>) => Promise<T>;
}

export const ui: Ui = { heading, step, ...say, link, waiting, fields, table, select, text, pause, pasteJson, mark, collapse, spin };
