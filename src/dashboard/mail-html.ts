import { FRAME_SCRIPT } from './frame-script.ts';

/**
 * A message's HTML made fit to show in the dashboard's frame. The frame's own policy is what keeps it
 * harmless (no script runs, nothing loads from elsewhere: `frameHeaders` in server.ts); this is the second
 * wall, so a browser that ignored the policy would still get nothing that runs or fetches by itself.
 *
 * The output is rebuilt from what was read, never passed through: every tag is written out again from
 * its name and the attributes kept, and a `<` that does not start a tag is escaped. So the browser sees
 * only the elements read here, whatever the source does to trip a parser up.
 *
 * Remote `src`, `srcset` and `background` are dropped rather than left for the policy to block: a plain
 * image is the usual tracking pixel, dropping it costs nothing, and the frame then has no violation to
 * report for each one. What held one is marked `data-sift-remote`, so the frame can tell the page there is
 * something for Show images to load (a `cid:` picture is not: Mild does not keep it). Once the reader asks
 * for them, HTTPS ones are kept; plain HTTP ones never, since they would name what is being read to anyone
 * on the network. `url(...)` in CSS is left to the policy, since CSS can spell a URL in too many ways
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
/** The only images that can show until the reader asks for the message's images (`SHOWN_IMAGE`). */
const INLINE_IMAGE = /^data:image\//i;
const SHOWN_IMAGE = /^(data:image\/|https:\/\/)/i;
const REMOTE = /^https?:\/\//i;
const IMAGE_ATTRIBUTES = new Set(['src', 'srcset', 'background', 'poster', 'lowsrc', 'dynsrc', 'data', 'xlink:href']);
/** Never kept: they act, fetch, or would undo what is set here. */
const NEVER = new Set(['formaction', 'action', 'ping', 'srcdoc', 'target', 'rel', 'http-equiv', 'download', 'xmlns', 'nonce', 'integrity']);

/**
 * A frame's `prefers-color-scheme` is the reader's system's, whatever the frame or the page around it declares, so mail
 * with dark styles of its own (Google Calendar's invitations) would draw them on the white paper. Mail is cleaned as
 * written for light, which is how it shows if the frame's script never runs or the reader asks for its original colours;
 * the script swaps the two as it darkens (`FRAME_SCRIPT`). `grid` is 0 on every screen, so `(grid:1)` never matches and
 * `(grid:0)` always does.
 */
const COLOR_SCHEME = /prefers-color-scheme\s*:\s*(dark|light)\b/gi;
const asLight = (css: string) => css.replace(COLOR_SCHEME, (_, scheme: string) => (scheme.toLowerCase() === 'dark' ? 'grid:1' : 'grid:0'));

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

function writeTag({ name, attributes, selfClosing }: Tag, images: boolean): string {
  const kept: string[] = [];
  const seen = new Set<string>();
  let link = false;
  let remote = false;
  for (const [key, raw] of attributes) {
    if (seen.has(key) || !/^[a-z][a-z0-9_.:-]*$/.test(key) || key.startsWith('on') || NEVER.has(key)) continue;
    seen.add(key);
    // Untrimmed, a browser would strip the spaces and read the scheme behind them.
    const value = raw?.trim() ?? null;
    if (key === 'href') {
      if (value === null || !LINK.test(value)) continue;
      link = name === 'a' || name === 'area';
    } else if (IMAGE_ATTRIBUTES.has(key) && (value === null || !(images ? SHOWN_IMAGE : INLINE_IMAGE).test(value))) {
      remote ||= !images && value !== null && REMOTE.test(value);
      continue;
    }
    kept.push(value === null ? key : `${key}=${quote(key === 'media' ? asLight(value) : value)}`);
  }
  if (link) kept.push('target="_blank"', 'rel="noopener noreferrer"');
  if (remote) kept.push('data-sift-remote');
  return `<${name}${kept.map((a) => ` ${a}`).join('')}${selfClosing ? ' /' : ''}>`;
}

/**
 * `html` with nothing left that runs, submits, redirects or loads by itself, and every link opening in a new tab.
 * `images`: the reader asked for its images, so those over HTTPS are kept.
 */
export function cleanHtml(html: string, images: boolean): string {
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
      if (tag.name === 'style') out += `${writeTag(tag, images)}${asLight(content)}</style>`;
      const close = end === -1 ? -1 : html.indexOf('>', at + end);
      at = close === -1 ? html.length : close + 1;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag.name)) {
      if (!tag.selfClosing) dropping = { name: tag.name, depth: 1 };
      continue;
    }
    // A name the browser would take for something odd (`scr<script`) is not written out at all.
    if (!DROP.has(tag.name) && NAME.test(tag.name)) out += writeTag(tag, images);
  }
  return out;
}

/** The dashboard's colours (`--foreground`, `--supporting`, `--border` in web/src/index.css), which the frame cannot read from the page. */
export const INK = { foreground: '#f0eee8', muted: '#a3a198', border: '#2b2b27' };

/** Laid out as tall as what it holds, so the frame can be as tall as that: a template's `height: 100%` would be the frame's. */
const OWN_HEIGHT = 'html,body{height:auto!important;min-height:0!important}';

/** The ••• that history a reply quotes is folded behind (`FRAME_SCRIPT`), drawn as the dashboard's quiet press. */
const quotePill = (ink: string, rest: string, fill: string) =>
  `details[data-sift-quote]{margin-top:.5em}details[data-sift-quote]>summary{display:inline-block;list-style:none;cursor:pointer;padding:0 .5em;border-radius:3px;font:600 14px/1.6 ui-sans-serif,system-ui,sans-serif;letter-spacing:.1em;background:transparent!important;color:${rest}!important}details[data-sift-quote]>summary::-webkit-details-marker{display:none}details[data-sift-quote]>summary:hover{background:${fill}!important;color:${ink}!important}details[data-sift-quote]>summary:focus-visible{outline:2px solid ${ink};outline-offset:2px}details[data-sift-quote][open]>summary{margin-bottom:.5em}`;

/**
 * Mail written as a letter, read as the dashboard's own text: its ink, its size, its line height, no box around it.
 * Colours, faces and line heights the letter names are its program's defaults far more often than anyone's choice
 * (Outlook's black Aptos at Word's 107%), and black on the dashboard would not read, nor lines that tight. The frame
 * loads no font, so the face is the system's, not the dashboard's.
 */
const LETTER = `<style>:root{color-scheme:dark;background:transparent;color:${INK.foreground};font:17px/1.625 ui-sans-serif,system-ui,sans-serif;overflow-wrap:break-word}${OWN_HEIGHT}body{margin:0}body,body *{line-height:inherit!important}body *{color:inherit!important;background-color:transparent!important;font-family:inherit!important;border-color:${INK.border}!important}body :is(pre,code,tt,kbd,samp){font-family:ui-monospace,monospace!important}a{text-decoration:underline;text-decoration-color:rgb(240 238 232/.35);text-underline-offset:.2em}a:hover{text-decoration-color:currentColor}body blockquote{margin:0 0 0 .25em!important;padding:0 0 0 1em!important;border-left:2px solid ${INK.border}!important;color:${INK.muted}!important}${quotePill(INK.foreground, 'rgb(240 238 232/.75)', 'rgb(240 238 232/.1)')}</style>`;

/**
 * Mail with a design of its own, on the white paper it is written for, which the frame's script darkens unless the reader
 * asked for its original colours (`data-sift-paper` is how it knows this is paper, not a letter). On a frame narrower than mail is written for, a
 * full-width table is laid out to the frame's width rather than its content's, so a 600px card inside it marked
 * `max-width: 100%` shrinks as its sender meant: in a table sized by its content, a percentage resolves against nothing
 * and the card keeps its 600px. Mail that still does not fit is scaled down by `FRAME_SCRIPT`.
 */
const PAPER = `<style data-sift-paper>:root{color-scheme:light;background:#fff;color:#000;overflow-wrap:break-word;scrollbar-width:thin}${OWN_HEIGHT}@media (max-width:640px){table[width="100%"]{table-layout:fixed}}${quotePill('#000', 'rgb(0 0 0/.6)', 'rgb(0 0 0/.07)')}</style>`;

const SCRIPT = `<script>${FRAME_SCRIPT}</script>`;

/** A background that leaves the dashboard showing through, or white, which a letter written in Gmail or Outlook sets on itself. */
const PLAIN_BACKGROUND =
  /^(?:transparent|none|inherit|initial|unset|white|#fff(?:fff)?|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(?:,\s*1(?:\.0*)?\s*)?\)|rgba\([^)]*,\s*0\s*\))$/i;
/** Wider than this, a table or block is a layout, not a letter's paragraph. */
const LAID_OUT_PX = 400;

/**
 * Whether cleaned HTML is a letter rather than a design: it has no background but white, no box laid out to a width,
 * and no styles for screen sizes. A reply written in Gmail, Outlook or Apple Mail is a letter; a newsletter, a receipt
 * or a notification with its sender's colours is not.
 */
export function isLetter(cleaned: string): boolean {
  if (/@media\b/i.test(cleaned)) return false;
  for (const [, value = ''] of cleaned.matchAll(/background(?:-color|-image)?\s*:\s*([^;"}]+)/gi)) {
    const plain = value.replace(/!important/i, '').trim();
    if (/url\(/i.test(plain) || !PLAIN_BACKGROUND.test(plain)) return false;
  }
  for (const [, value = ''] of cleaned.matchAll(/\sbgcolor="([^"]*)"/gi)) if (!PLAIN_BACKGROUND.test(value.trim())) return false;
  for (const [, value = '0'] of cleaned.matchAll(/\swidth="(\d+)/gi)) if (Number(value) >= LAID_OUT_PX) return false;
  for (const [, value = '0'] of cleaned.matchAll(/(?:^|[\s;"{])(?:min-|max-)?width\s*:\s*(\d+(?:\.\d+)?)px/gi)) if (Number(value) >= LAID_OUT_PX) return false;
  return true;
}

/** The document the frame shows: the cleaned message, as a letter or on paper, with the frame's own script. */
export function mailDocument(html: string, images: boolean): string {
  const cleaned = cleanHtml(html, images);
  const doctype = /^\s*<!doctype[^<>]*>/i.exec(cleaned)?.[0] ?? '';
  return `${doctype.trim()}${isLetter(cleaned) ? LETTER : PAPER}${SCRIPT}${cleaned.slice(doctype.length)}`;
}

/** A sentence in the frame in place of the message, as the dashboard says one. */
export const frameNote = (sentence: string) =>
  `<!doctype html>${LETTER}${SCRIPT}<p style="color:${INK.muted}!important;margin:0">${sentence.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</p>`;
