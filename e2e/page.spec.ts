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
  ]) {
    const page = await request.get(path);
    expect(page.status(), path).toBe(200);
    expect(page.headers()['content-type']).toContain('text/html');
    expect(page.headers()['content-security-policy']).toContain("default-src 'none'");
  }
  expect((await request.get('/rules.json')).status()).toBe(404);
  expect((await request.get('/_next/static/missing.js')).status()).toBe(404);
  expect((await request.get('/api/rules/nope')).status()).toBe(404);
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

test('built files are kept by the browser for good', async ({ page }) => {
  const scripts: string[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/_next/static/')) scripts.push(response.headers()['cache-control'] ?? '');
  });
  await page.goto('/');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  expect(scripts.length).toBeGreaterThan(0);
  for (const cache of scripts) expect(cache).toContain('immutable');
});
