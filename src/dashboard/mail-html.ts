/**
 * A message's HTML made fit to show in the dashboard's frame. The frame's own policy is what keeps it
 * harmless (no script runs, nothing loads from elsewhere: `FRAME_HEADERS` in server.ts); this is the second
 * wall, so a browser that ignored the policy would still get nothing that runs or fetches by itself.
 *
 * The output is rebuilt from what was read, never passed through: every tag is written out again from
 * its name and the attributes kept, and a `<` that does not start a tag is escaped. So the browser sees
 * only the elements read here, whatever the source does to trip a parser up.
 *
 * Remote `src`, `srcset` and `background` are dropped rather than left for the policy to block: a plain
 * image is the usual tracking pixel, dropping it costs nothing, and the frame then has no violation to
 * report for each one. `url(...)` in CSS is left to the policy, since CSS can spell a URL in too many ways
 * (escapes, comments, `image-set`) for a rewrite to be sure of catching them all.
 */

/** Dropped with everything in them. svg and math parse differently from HTML, so what is inside cannot be read the way the browser would. */
const DROP_WITH_CONTENT = new Set(['script', 'title', 'svg', 'math']);
/** Dropped, keeping what is inside as ordinary content. */
const DROP = new Set([
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'form',
  'base',
  'meta',
  'link',
  'xmp',
  'noembed',
  'noframes',
  'plaintext',
  'textarea',
  'template',
]);
/** Read as text up to their closing tag. `style` is kept; the others are dropped. */
const RAW_TEXT = new Set(['style', 'script', 'title']);
/** The only links kept: anything else (`javascript:`, `data:`, a relative path) loses its address. */
const LINK = /^(https?:\/\/|mailto:)/i;
/** The only images that can show, since the frame loads nothing from elsewhere. */
const INLINE_IMAGE = /^data:image\//i;
const IMAGE_ATTRIBUTES = new Set(['src', 'srcset', 'background', 'poster', 'lowsrc', 'dynsrc', 'data', 'xlink:href']);
/** Never kept: they act, fetch, or would undo what is set here. */
const NEVER = new Set(['formaction', 'action', 'ping', 'srcdoc', 'target', 'rel', 'http-equiv', 'download', 'xmlns', 'nonce', 'integrity']);

/** Comments, doctypes, `<?…>` and closing tags. None of these can nest or backtrack. */
const OTHER = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w:-]*)[^>]*>/y;
const SPACE = /[\t\n\f\r ]/;
/** The only element names written out. */
const NAME = /^[a-z][a-z0-9-]*$/;

interface Tag {
  name: string;
  attributes: [string, string | null][];
  selfClosing: boolean;
  end: number;
}

/** The start tag at `at` (which holds `<` and a letter), read as the HTML tokenizer reads one. Null if it never closes. */
function readTag(html: string, at: number): Tag | null {
  let i = at + 1;
  const nameStart = i;
  while (i < html.length && !SPACE.test(html[i]!) && html[i] !== '/' && html[i] !== '>') i++;
  const name = html.slice(nameStart, i).toLowerCase();
  const attributes: [string, string | null][] = [];
  let selfClosing = false;
  while (i < html.length) {
    const c = html[i]!;
    if (c === '>') return { name, attributes, selfClosing, end: i + 1 };
    if (SPACE.test(c)) {
      i++;
      continue;
    }
    if (c === '/') {
      selfClosing = html[i + 1] === '>';
      i++;
      continue;
    }
    selfClosing = false;
    const keyStart = i;
    i++;
    while (i < html.length && !SPACE.test(html[i]!) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++;
    const key = html.slice(keyStart, i).toLowerCase();
    let j = i;
    while (j < html.length && SPACE.test(html[j]!)) j++;
    if (html[j] !== '=') {
      attributes.push([key, null]);
      continue;
    }
    j++;
    while (j < html.length && SPACE.test(html[j]!)) j++;
    const q = html[j];
    if (q === '"' || q === "'") {
      const close = html.indexOf(q, j + 1);
      if (close === -1) return null;
      attributes.push([key, html.slice(j + 1, close)]);
      i = close + 1;
    } else {
      const valueStart = j;
      while (j < html.length && !SPACE.test(html[j]!) && html[j] !== '>') j++;
      attributes.push([key, html.slice(valueStart, j)]);
      i = j;
    }
  }
  return null;
}

const escapeText = (text: string) => text.replaceAll('<', '&lt;');
const quote = (value: string) => `"${value.replaceAll('"', '&quot;')}"`;

function writeTag({ name, attributes, selfClosing }: Tag): string {
  const kept: string[] = [];
  const seen = new Set<string>();
  let link = false;
  for (const [key, raw] of attributes) {
    if (seen.has(key) || !/^[a-z][a-z0-9_.:-]*$/.test(key) || key.startsWith('on') || NEVER.has(key)) continue;
    seen.add(key);
    // Untrimmed, a browser would strip the spaces and read the scheme behind them.
    const value = raw?.trim() ?? null;
    if (key === 'href') {
      if (value === null || !LINK.test(value)) continue;
      link = name === 'a' || name === 'area';
    } else if (IMAGE_ATTRIBUTES.has(key) && (value === null || !INLINE_IMAGE.test(value))) continue;
    kept.push(value === null ? key : `${key}=${quote(value)}`);
  }
  if (link) kept.push('target="_blank"', 'rel="noopener noreferrer"');
  return `<${name}${kept.map((a) => ` ${a}`).join('')}${selfClosing ? ' /' : ''}>`;
}

/** `html` with nothing left that runs, submits, redirects or loads by itself, and every link opening in a new tab. */
export function cleanHtml(html: string): string {
  let out = '';
  let at = 0;
  /** Inside an element dropped with its content: its name and how deep. */
  let dropping: { name: string; depth: number } | null = null;
  const text = (value: string) => {
    if (!dropping) out += escapeText(value);
  };
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    if (lt === -1) {
      text(html.slice(at));
      break;
    }
    text(html.slice(at, lt));
    OTHER.lastIndex = lt;
    const other = OTHER.exec(html);
    if (other) {
      at = OTHER.lastIndex;
      const closing = other[1]?.toLowerCase();
      if (closing === undefined) {
        // A doctype keeps the layout in the mode the message was written for. Comments and the rest go.
        if (!dropping && /^<!doctype\s+html\b[^<]*>$/i.test(other[0])) out += other[0];
      } else if (dropping) {
        if (closing === dropping.name && --dropping.depth === 0) dropping = null;
      } else if (!DROP.has(closing) && !DROP_WITH_CONTENT.has(closing) && NAME.test(closing)) out += `</${closing}>`;
      continue;
    }
    const tag = /[a-zA-Z]/.test(html[lt + 1] ?? '') ? readTag(html, lt) : null;
    if (!tag) {
      text('<');
      at = lt + 1;
      continue;
    }
    at = tag.end;
    if (dropping) {
      if (tag.name === dropping.name && !tag.selfClosing) dropping.depth++;
      continue;
    }
    if (RAW_TEXT.has(tag.name)) {
      const end = html.slice(at).search(new RegExp(`</${tag.name}[\\t\\n\\f\\r />]`, 'i'));
      const content = end === -1 ? html.slice(at) : html.slice(at, at + end);
      // A style element is text to the browser up to its closing tag, which `content` cannot hold.
      if (tag.name === 'style') out += `${writeTag(tag)}${content}</style>`;
      const close = end === -1 ? -1 : html.indexOf('>', at + end);
      at = close === -1 ? html.length : close + 1;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag.name)) {
      if (!tag.selfClosing) dropping = { name: tag.name, depth: 1 };
      continue;
    }
    // A name the browser would take for something odd (`scr<script`) is not written out at all.
    if (!DROP.has(tag.name) && NAME.test(tag.name)) out += writeTag(tag);
  }
  return out;
}

/** Under the message's own styles: email is written for white paper, whatever the dashboard's colours. */
const PAPER = '<style>:root{color-scheme:light;background:#fff;color:#000}</style>';

/** The document the frame shows: the cleaned message, on white. */
export function mailDocument(html: string): string {
  const cleaned = cleanHtml(html);
  const doctype = /^\s*<!doctype[^<>]*>/i.exec(cleaned)?.[0] ?? '';
  return `${doctype.trim()}${PAPER}${cleaned.slice(doctype.length)}`;
}

/** A sentence in the frame in place of the message. */
export const frameNote = (sentence: string) =>
  `<!doctype html>${PAPER}<style>body{font:15px/1.5 system-ui,sans-serif;color:#555;margin:16px}</style><p>${sentence.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>`;
