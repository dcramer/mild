import { createHash } from 'node:crypto';

/**
 * The one script a message's frame runs, Mild's own: the frame's policy allows it by its hash and nothing else, and the
 * cleaner strips every script the mail brings. It runs in the sandbox, with no origin of its own and no network, so even
 * mail that got a script past both could reach neither the dashboard nor anywhere else.
 *
 * It does what a mail app does to a message before showing it: darkens mail designed for white paper, folds the history
 * a reply quotes under it behind •••, scales mail written wider than the column down to fit, and tells the page how tall
 * the message is (whether it asked for images it did not get, and whether it is on paper, which Show original colours
 * shows as sent), so the frame is as tall as the message and the page scrolls as one.
 *
 * Darkening is done as the mail apps that darken mail do it (Outlook, Gmail's apps), not by inverting the whole page,
 * which turns photographs into negatives: the sender's own dark styles are switched on (the cleaner turns them off,
 * `asLight`), then each colour still drawn light is turned dark, keeping its hue, from the colours as the browser
 * resolved them, so inline styles, `bgcolor` and style sheets are all caught alike. Text is lightened only over a
 * background that ended up dark. Images are left as sent. The frame's address ending `#original` shows it all as sent, and changing it switches without a reload.
 *
 * It runs before the message is parsed, so what it takes from `document` is the browser's own: an image named
 * `createElement` would replace `document.createElement` once parsed. Plain JavaScript, not a function's source,
 * which a bundler would rewrite with helpers from outside it.
 */
export const FRAME_SCRIPT = `(() => {
  const root = document.documentElement;
  const create = document.createElement.bind(document);
  const range = document.createRange.bind(document);
  const on = document.addEventListener.bind(document);
  const sheets = document.styleSheets;
  const computed = window.getComputedStyle.bind(window);
  const up = window.parent;
  // The dashboard's ground (--background) and ink (--foreground), as HSL lightness.
  const GROUND = 0.065;
  const INK = 0.93;
  const rgb = (value) => {
    const m = /^rgba?\\(([^)]*)\\)$/.exec(value);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [r, g, b].some((c) => !Number.isFinite(c)) || !Number.isFinite(a) ? null : { r, g, b, a };
  };
  const linear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = ({ r, g, b }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  // Lightness moved to \`to(l)\` and chroma scaled by \`keep\` (as far as the new lightness allows), hue kept.
  const relit = ({ r, g, b, a }, to, keep = 1) => {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const d = max - min;
    const l = (max + min) / 2;
    const h = d === 0 ? 0 : max === R ? (((G - B) / d) % 6 + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    const L = to(l);
    const c = Math.min(d * keep, 1 - Math.abs(2 * L - 1));
    const x = c * (1 - Math.abs((h % 2) - 1));
    const [p, q, t] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    const v = (n) => Math.round((n + L - c / 2) * 255);
    return { r: v(p), g: v(q), b: v(t), a };
  };
  const css = ({ r, g, b, a }) => 'rgb(' + r + ' ' + g + ' ' + b + ' / ' + a + ')';
  // A light ground goes dark in reverse order of its lightness, white to the dashboard's own, a tint fainter, since
  // the same colour reads stronger on dark; one already dark stays. A light line goes no darker than the dashboard's
  // own (--border), so it still shows on the ground it divides.
  const LIGHT = 0.35;
  const ground = (colour) => (luminance(colour) > LIGHT ? relit(colour, (l) => GROUND + (1 - l) * 0.5, 0.6) : colour);
  const line = (colour) => (luminance(colour) > LIGHT ? relit(colour, (l) => Math.max(GROUND + (1 - l) * 0.5, 0.2), 0.6) : colour);
  // A gradient's colours, each as a ground; an image's own are unknown, and left.
  const COLOURS = /rgba?\\([^)]*\\)/g;
  const grounds = (image) => image.replace(COLOURS, (colour) => (rgb(colour) ? css(ground(rgb(colour))) : colour));
  const SIDES = ['top', 'right', 'bottom', 'left'];
  let undo = [];
  const set = (element, property, value) => {
    undo.push([element, property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
    element.style.setProperty(property, value, 'important');
  };
  // The cleaner writes the sender's dark styles as \`(grid:1)\`, which never matches, and their light ones as \`(grid:0)\`.
  const flip = (media) => media.replace(/grid: ?([01])/g, (_, n) => 'grid:' + (1 - Number(n)));
  const flipMedia = () => {
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.media && /grid/.test(rule.media.mediaText)) rule.media.mediaText = flip(rule.media.mediaText);
        if (rule.cssRules) walk(rule.cssRules);
      }
    };
    for (const sheet of sheets) walk(sheet.cssRules);
    for (const element of root.querySelectorAll('[media]')) element.setAttribute('media', flip(element.getAttribute('media')));
  };
  const darken = () => {
    const read = [root, ...root.querySelectorAll('body, body *')].map((element) => {
      const style = computed(element);
      const bg = rgb(style.backgroundColor);
      return {
        element,
        color: rgb(style.color),
        bg: bg && bg.a > 0.1 ? bg : null,
        image: style.backgroundImage,
        borders: SIDES.map((side) => (style.getPropertyValue('border-' + side + '-width') === '0px' ? null : rgb(style.getPropertyValue('border-' + side + '-color')))),
      };
    });
    const at = new Map(read.map((seen) => [seen.element, seen]));
    const under = new Map();
    // The luminance of what an element's text is drawn over once darkened: its colour, a gradient's first, or else its
    // parent's. A picture is taken as the colour under it, which it is while images are blocked; Outlook does the same.
    const over = (seen) => {
      if (!seen) return 0;
      if (under.has(seen.element)) return under.get(seen.element);
      const stop = /gradient/.test(seen.image) ? rgb(seen.image.match(COLOURS)?.[0] ?? '') : null;
      const below = seen.bg ?? stop;
      const found = below ? luminance(ground(below)) : over(at.get(seen.element.parentElement));
      under.set(seen.element, found);
      return found;
    };
    for (const seen of read) {
      const { element, color, bg, borders } = seen;
      if (bg && ground(bg) !== bg) set(element, 'background-color', css(ground(bg)));
      if (/gradient/.test(seen.image)) set(element, 'background-image', grounds(seen.image));
      borders.forEach((border, i) => {
        if (border && line(border) !== border) set(element, 'border-' + SIDES[i] + '-color', css(line(border)));
      });
      const behind = over(seen);
      if (color && luminance(color) < LIGHT && behind < 0.18) set(element, 'color', css(relit(color, (l) => INK - l * 0.4)));
    }
    set(root, 'color-scheme', 'dark');
  };
  let darkened = false;
  // Only mail on paper is darkened: a letter is already in the dashboard's ink. Mild's own style is the document's first.
  const colour = () => {
    const dark = root.querySelector('style')?.hasAttribute('data-sift-paper') === true && location.hash !== '#original';
    if (dark === darkened) return;
    darkened = dark;
    flipMedia();
    if (dark) darken();
    else {
      for (const [element, property, value, priority] of undo.reverse()) value ? element.style.setProperty(property, value, priority) : element.style.removeProperty(property);
      undo = [];
    }
  };
  // Where each mail program starts the history under a reply. Outlook's own app marks it only by a rule over "From:".
  const MARKS = '.gmail_quote, .yahoo_quoted, .protonmail_quote, .moz-cite-prefix, #appendonsend, #divRplyFwdMsg, blockquote[type="cite"], div[style*="border-top"]';
  const is = (node, selector) => node.nodeType === 1 && node.matches(selector);
  // Words only: a sender's tracking pixel after the history, which Superhuman and mail trackers put last, is no reply.
  const shows = (node) => (node.nodeType === 1 || node.nodeType === 3) && node.textContent.trim() !== '';
  // Outlook's history is the message it answers, unquoted, in the blocks after its head.
  const HEADS = '#appendonsend, #divRplyFwdMsg, div[style*="border-top"]';
  const after = (node) => {
    const rest = [];
    for (let next = node.nextSibling; next; next = next.nextSibling) if (shows(next)) rest.push(next);
    return rest;
  };
  // A blockquote no program marked starts history only under "On …, Ada <ada@example.org> wrote:", the line before it
  // back to the last break or block; its nodes, which may be text, a mailto link and text again.
  const ATTRIBUTION = /^On\\s[\\s\\S]+\\swrote:$/;
  const attribution = (quote) => {
    const line = [];
    for (let node = quote.previousSibling; node; node = node.previousSibling) {
      if (is(node, 'br')) {
        if (line.some(shows)) break;
        continue;
      }
      if (node.nodeType !== 1 && node.nodeType !== 3) continue;
      line.unshift(node);
      if (node.nodeType === 1 && computed(node).display !== 'inline') break;
    }
    return ATTRIBUTION.test(line.map((node) => node.textContent).join('').replace(/\\s+/g, ' ').trim()) ? line : null;
  };
  // Where the history starts, and the line that says whose it is, which the quote under it follows.
  const history = (body) => {
    for (const mark of body.querySelectorAll(MARKS + ', blockquote')) {
      if (!mark.matches(MARKS)) {
        const line = attribution(mark);
        if (line) return { start: line[0], line };
      } else if (!mark.matches('div[style*="border-top"]') || /^\\s*From:/.test(mark.textContent)) return { start: mark, line: mark.matches('.moz-cite-prefix') ? [mark] : [] };
    }
    return null;
  };
  const fold = (body) => {
    const found = history(body);
    if (!found) return;
    const { start, line } = found;
    // Only history that ends the message: a reply written between quoted lines needs them.
    const rest = after(start).filter((next) => !(line.length > 0 && (line.includes(next) || is(next, 'blockquote'))));
    if (!is(start, HEADS) && rest.length > 0) return;
    for (let at = start.parentElement; at && at !== body && at !== root; at = at.parentElement) if (after(at).length > 0) return;
    const before = range();
    before.setStart(body, 0);
    before.setEndBefore(start);
    let quoted = '';
    for (let node = start; node; node = node.nextSibling) quoted += node.textContent;
    // A forward, or a message that is nothing but what it quotes, is all there is to read.
    if (before.toString().trim() === '' || /forwarded message/i.test(quoted)) return;
    const details = create('details');
    details.setAttribute('data-sift-quote', '');
    const summary = create('summary');
    summary.textContent = '•••';
    summary.setAttribute('aria-label', 'Show the quoted text');
    details.addEventListener('toggle', () => summary.setAttribute('aria-label', details.open ? 'Hide the quoted text' : 'Show the quoted text'));
    details.append(summary);
    start.before(details);
    for (let node = start, next; node; node = next) {
      next = node.nextSibling;
      details.append(node);
    }
  };
  let width = -1;
  let told = '';
  let blocked = false;
  const fit = () => {
    root.style.zoom = '';
    const room = root.clientWidth;
    const wide = root.scrollWidth;
    // Past half size it is unreadable; it scrolls sideways in its frame instead.
    if (wide > room + 1) root.style.zoom = String(Math.max(room / wide, 0.5));
  };
  const tell = () => {
    if (window.innerWidth !== width) {
      width = window.innerWidth;
      fit();
    }
    const height = Math.ceil(root.getBoundingClientRect().height);
    const paper = root.querySelector('style')?.hasAttribute('data-sift-paper') === true;
    const said = height + ' ' + blocked;
    if (said === told) return;
    told = said;
    up.postMessage({ sift: 'mail-frame', height, blocked, paper }, '*');
  };
  on('securitypolicyviolation', (event) => {
    if (event.effectiveDirective !== 'img-src' || blocked) return;
    blocked = true;
    tell();
  });
  window.addEventListener('hashchange', colour);
  on('DOMContentLoaded', () => {
    colour();
    const body = root.querySelector('body');
    if (body) fold(body);
    blocked ||= root.querySelector('[data-sift-remote]') !== null;
    root.style.overflowY = 'hidden';
    const watch = new ResizeObserver(tell);
    watch.observe(root);
    if (body) watch.observe(body);
    tell();
  });
})();`;

/** For the frame's policy: this script and no other. */
export const FRAME_SCRIPT_HASH = `'sha256-${createHash('sha256').update(FRAME_SCRIPT).digest('base64')}'`;
