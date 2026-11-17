import { expect, test } from './sift.ts';

test('the page is sent under a strict policy whose nonce is new each time, and never kept by a cache', async ({ page }) => {
  const { request } = page;
  const first = await request.get('/');
  const second = await request.get('/');
  expect(first.status()).toBe(200);
  const csp = first.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(second.headers()['content-security-policy']).not.toContain(nonce);
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("style-src 'self';");
  expect(csp).not.toContain('unsafe');
  // The one frame the page may hold is a message from this server's own frame route.
  expect(csp.split('; ').filter((d) => d.startsWith('frame'))).toEqual(["frame-src 'self'", "frame-ancestors 'none'"]);
  expect(first.headers()['cache-control']).toContain('no-store');
  expect(first.headers()['x-powered-by']).toBeUndefined();
  // Every script in the page is one the nonce lets run.
  const html = await first.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`);
  // Nothing from the record is in the page: it fetches that from the API.
  expect(html).not.toContain('example.com');

  await page.goto('/');
  await expect(page.getByRole('navigation').first()).toBeVisible();
});

test('every address the page reads is the page, and a missing file is not', async ({ page }) => {
  const { request } = page;
  for (const path of [
    '/rules',
    '/settings/accounts',
    '/system',
    '/privacy',
    '/decisions?q=digest&message=a',
    '/sender/me%40example.org/news%40example.com',
    '/domain/me%40example.org/example.com',
    // Next.js draws the page wherever it has no route, Workflow's paths included.
    '/.well-known/workflow/v1/nothing',
  ]) {
    const page = await request.get(path);
    expect(page.status(), path).toBe(200);
    expect(page.headers()['content-type']).toContain('text/html');
    expect(page.headers()['content-security-policy']).toContain("default-src 'none'");
  }
  expect((await request.get('/rules.json')).status()).toBe(404);
  expect((await request.get('/api/rules/nope')).status()).toBe(404);
  // What Next.js draws for a missing built file runs nothing: proxy.ts gives no nonce there.
  const missing = await request.get('/_next/static/missing.js');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['content-security-policy']).toContain("script-src 'self';");
  // Nothing uses next/image, and Sift makes no Workflow webhook.
  expect((await request.get('/_next/image?url=%2Ficons%2Fapple-touch-icon.png&w=64&q=75')).status()).toBe(404);
  expect((await request.post('/.well-known/workflow/v1/webhook/token')).status()).toBe(404);
});

test('the app manifest and service worker are files of this server, which the policy allows', async ({ page }) => {
  const { request } = page;
  const csp = (await request.get('/')).headers()['content-security-policy'] ?? '';
  expect(csp).toContain("manifest-src 'self'");
  expect(csp).toContain("worker-src 'self'");
  expect((await request.get('/manifest.webmanifest')).headers()['content-type']).toContain('application/manifest+json');
  const worker = await request.get('/sw.js');
  expect(worker.headers()['content-type']).toContain('javascript');
  // Checked with the server each time: a browser must see a new worker to replace the old one.
  expect(worker.headers()['cache-control']).toMatch(/max-age=0|no-store|no-cache/);
});

test('built files are kept by the browser for good, read only as what they say they are, and come without their source', async ({ page }) => {
  const built: { url: string; headers: Record<string, string> }[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/_next/static/')) built.push({ url: response.url(), headers: response.headers() });
  });
  await page.goto('/');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  expect(built.length).toBeGreaterThan(0);
  for (const { url, headers } of built) {
    expect(headers['cache-control'], url).toContain('immutable');
    expect(headers['x-content-type-options'], url).toBe('nosniff');
    expect(headers['referrer-policy'], url).toBe('no-referrer');
  }
  const script = built.find(({ url }) => url.endsWith('.js'))?.url ?? '';
  expect((await page.request.get(`${script}.map`)).status()).toBe(404);
});
