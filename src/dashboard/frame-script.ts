import { createHash } from 'node:crypto';

/**
 * The one script a message's frame runs, Sift's own: the frame's policy allows it by its hash and nothing else, and the
 * cleaner strips every script the mail brings. It runs in the sandbox, with no origin of its own and no network, so even
 * mail that got a script past both could reach neither the dashboard nor anywhere else.
 *
 * It does what a mail app does to a message before showing it: folds the history a reply quotes under it behind •••,
 * scales mail written wider than the column down to fit, and tells the page how tall the message is (and whether it
 * asked for images it did not get), so the frame is as tall as the message and the page scrolls as one.
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
  const up = window.parent;
  // Where each mail program starts the history under a reply. Outlook's own app marks it only by a rule over "From:".
  const MARKS = '.gmail_quote, .yahoo_quoted, .protonmail_quote, .moz-cite-prefix, #appendonsend, #divRplyFwdMsg, blockquote[type="cite"], div[style*="border-top"]';
  const shows = (node) => node.nodeType === 3 ? node.textContent.trim() !== '' : node.nodeType === 1 && (node.textContent.trim() !== '' || node.matches('img') || node.querySelector('img') !== null);
  // Outlook's history is the message it answers, unquoted, in the blocks after its head.
  const HEADS = '#appendonsend, #divRplyFwdMsg, div[style*="border-top"]';
  const after = (node) => {
    const rest = [];
    for (let next = node.nextSibling; next; next = next.nextSibling) if (shows(next)) rest.push(next);
    return rest;
  };
  const fold = (body) => {
    const start = [...body.querySelectorAll(MARKS)].find((mark) => !mark.matches('div[style*="border-top"]') || /^\\s*From:/.test(mark.textContent));
    if (!start) return;
    // Only history that ends the message: a reply written between quoted lines needs them.
    const rest = after(start);
    if (!start.matches(HEADS) && rest.some((next) => !(start.matches('.moz-cite-prefix') && next.nodeType === 1 && next.matches('blockquote')))) return;
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
    const said = height + ' ' + blocked;
    if (said === told) return;
    told = said;
    up.postMessage({ sift: 'mail-frame', height, blocked }, '*');
  };
  on('securitypolicyviolation', (event) => {
    if (event.effectiveDirective !== 'img-src' || blocked) return;
    blocked = true;
    tell();
  });
  on('DOMContentLoaded', () => {
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
