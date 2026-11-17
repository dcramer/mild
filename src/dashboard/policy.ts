/**
 * The content security policy. Subjects and sender names are untrusted. The page only ever renders them as
 * text, and this is the backstop: no script but the page's own, no inline style, nothing loaded from another
 * origin. `manifest-src` and `worker-src` let the page be installed as an app with its own service worker;
 * both are files of this server's. (`worker-src` would fall back to `script-src` in most browsers, but not in
 * older Safari.) `frame-src` is for a message shown as its HTML, which comes from this server's own frame route.
 */
const policy = (script: string, style: string) =>
  `default-src 'none'; script-src ${script}; style-src ${style}; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const SAFE = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

/** Sent with everything the API answers. */
export const HEADERS = { 'content-security-policy': policy("'self'", "'self'"), ...SAFE };

/**
 * Sent with the page (`proxy.ts`). Next.js starts the page with inline scripts, so each carries this request's
 * nonce and what they load is trusted through them (`'strict-dynamic'`); nothing from mail is in the page
 * itself, which fetches it from the API. Next's development server also evaluates code and injects styles.
 */
export function pageHeaders(nonce: string, dev: boolean): Record<string, string> {
  const script = `'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`;
  return { 'content-security-policy': policy(script, dev ? "'self' 'unsafe-inline'" : "'self'"), ...SAFE };
}

/**
 * A message's own HTML. Nothing in it runs (`sandbox` without `allow-scripts`), it has no origin of its own to
 * reach the dashboard's data from (no `allow-same-origin`), and it loads nothing from anywhere, this server
 * included: no image, font, stylesheet or tracking pixel. Its own inline styles are all it may have. Links open
 * in a new tab, which is not sandboxed so the site linked to works.
 */
export const FRAME_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox";
