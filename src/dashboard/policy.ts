/**
 * What the API answers under: its replies are data, so the policy runs nothing and loads nothing.
 */
const policy = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const SAFE = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

/** Sent with everything the API answers. */
export const HEADERS = { 'content-security-policy': policy, ...SAFE };

/**
 * Sent with the page and its files (next.config.js), for what each protects. No other site may frame the dashboard
 * and trick a press; a sender's page has their address in its path, which must not reach a site the reader goes on
 * to; nothing is read as other than it says it is; and no plugin or other base for its links. What the page shows
 * from mail is React's text, never HTML, and a message's own HTML is in a frame with a policy of its own.
 */
export const PAGE_HEADERS = { 'content-security-policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'", ...SAFE };

/**
 * A message's own HTML. Nothing in it runs (`sandbox` without `allow-scripts`), it has no origin of its own to
 * reach the dashboard's data from (no `allow-same-origin`), and it loads nothing from anywhere, this server
 * included: no image, font, stylesheet or tracking pixel. Its own inline styles are all it may have. Links open
 * in a new tab, which is not sandboxed so the site linked to works.
 */
export const FRAME_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox";
