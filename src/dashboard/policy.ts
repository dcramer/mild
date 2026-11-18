/** Nothing is read as other than it says it is. */
export const NOSNIFF = { 'x-content-type-options': 'nosniff' };

/**
 * Sent with the page and its files (next.config.js), for what each protects. No other site may frame the dashboard
 * and trick a press; a sender's page has their address in its path, which must not reach a site the reader goes on
 * to; nothing is read as other than it says it is; and no plugin or other base for its links. What the page shows
 * from mail is React's text, never HTML, and a message's own HTML is in a frame with a policy of its own.
 */
export const PAGE_HEADERS = {
  'content-security-policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  ...NOSNIFF,
  'referrer-policy': 'no-referrer',
};

/**
 * A message's own HTML. Nothing in it runs (`sandbox` without `allow-scripts`), it has no origin of its own to
 * reach the dashboard's data from (no `allow-same-origin`), and it loads nothing from anywhere, this server
 * included: no image, font, stylesheet or tracking pixel. Its own inline styles are all it may have. Links open
 * in a new tab, which is not sandboxed so the site linked to works.
 */
export const FRAME_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox";
