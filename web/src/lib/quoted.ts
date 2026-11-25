/** "On Tue, 3 Nov 2026 at 10:00, Ada <ada@example.org> wrote:", which Gmail wraps onto a second line when it is long. */
const ATTRIBUTION = /^On\s.+\swrote:\s*$/;
const ATTRIBUTION_START = /^On\s/;
const ATTRIBUTION_END = /\swrote:\s*$|^wrote:\s*$/;
/** Outlook's: a line of underscores, or "-----Original Message-----", then the message it answers, unquoted. */
const DIVIDER = /^(?:_{10,}|-{2,}\s*Original Message\s*-{2,})\s*$/i;
/** Outlook's head of the message it answers, without a divider. */
const HEAD = /^From:\s/;
const HEAD_NEXT = /^(?:Sent|Date):\s/;

const isQuoted = (line: string) => line.startsWith('>');
const allQuoted = (lines: readonly string[]) => lines.every((line) => line.trim() === '' || isQuoted(line));

/** Where the history a reply quotes starts, if it runs to the end; -1 if it does not, or there is none. */
function quoteStart(lines: readonly string[]): number {
  for (const [i, line] of lines.entries()) {
    if (ATTRIBUTION.test(line) && allQuoted(lines.slice(i + 1))) return i;
    if (ATTRIBUTION_START.test(line) && ATTRIBUTION_END.test(lines[i + 1] ?? '') && allQuoted(lines.slice(i + 2))) return i;
    if (DIVIDER.test(line)) return i;
    if (HEAD.test(line) && lines.slice(i + 1, i + 4).some((next) => HEAD_NEXT.test(next))) return i;
    if (isQuoted(line) && allQuoted(lines.slice(i))) return i;
  }
  return -1;
}

/**
 * A message's text, split where the history it quotes begins, as a mail app folds it: only history that ends the
 * message (a reply written between quoted lines needs them), and never a forward or a message that is nothing but
 * what it quotes, which are all there is to read.
 */
export function splitQuoted(text: string): { own: string; quoted: string | null } {
  const lines = text.split('\n');
  const at = quoteStart(lines);
  if (at === -1) return { own: text, quoted: null };
  const own = lines.slice(0, at).join('\n').trimEnd();
  const quoted = lines.slice(at).join('\n').trim();
  if (own.trim() === '' || /^-+ ?Forwarded message ?-+$|^Begin forwarded message:/im.test(text)) return { own: text, quoted: null };
  return { own, quoted };
}

/** The most lines a signature runs to: more under a "--" line are the message itself, as a mail program reads them. */
const SIGNATURE_LINES = 12;

/** A message's own text, split where its signature starts: at its last "-- " line (or "--"), with no more than a signature's lines under it. */
export function splitSignature(text: string): { own: string; signature: string | null } {
  const lines = text.split('\n');
  const at = lines.findLastIndex((line) => line.trimEnd() === '--');
  if (at === -1 || lines.length - at - 1 > SIGNATURE_LINES || lines.slice(at + 1).every((line) => line.trim() === '')) return { own: text, signature: null };
  return { own: lines.slice(0, at).join('\n').trimEnd(), signature: lines.slice(at).join('\n').trimEnd() };
}
