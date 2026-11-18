import { PAGE_HEADERS } from '../src/dashboard/policy.ts';
import { expect, senderPage, test } from './sift.ts';

test("the page cannot be framed by another site, sends no referrer, and holds nothing of anyone's", async ({ page }) => {
  const { request } = page;
  const first = await request.get('/');
  expect(first.status()).toBe(200);
  for (const [name, value] of Object.entries(PAGE_HEADERS)) expect(first.headers()[name], name).toBe(value);
  expect(first.headers()['x-powered-by']).toBeUndefined();
  // Nothing from the record is in the page: it fetches that from the API.
  expect(await first.text()).not.toContain('example.com');

  await page.goto('/');
  await expect(page.getByRole('navigation').first()).toBeVisible();
});

test('each screen is an address of its own, and anything else is missing', async ({ page }) => {
  const { request } = page;
  for (const path of [
    '/',
    '/activity',
    '/labels',
    '/rules',
    '/rules?q=digest&message=a',
    '/system',
    '/privacy',
    '/sender/me%40example.org/news%40example.com',
    '/domain/me%40example.org/example.com',
  ]) {
    const page = await request.get(path);
    expect(page.status(), path).toBe(200);
    expect(page.headers()['content-type']).toContain('text/html');
    expect(page.headers()['content-security-policy']).toBe(PAGE_HEADERS['content-security-policy']);
  }
  for (const path of ['/settings/accounts', '/decisions', '/rules.json', '/.well-known/workflow/v1/nothing', '/sender/me%40example.org'])
    expect((await request.get(path)).status(), path).toBe(404);
  expect((await request.get('/api/rules/nope')).status()).toBe(404);
  expect((await request.get('/_next/static/missing.js')).status()).toBe(404);
  // Nothing uses next/image, and Sift makes no Workflow webhook.
  expect((await request.get('/_next/image?url=%2Ficons%2Fapple-touch-icon.png&w=64&q=75')).status()).toBe(404);
  expect((await request.post('/.well-known/workflow/v1/webhook/token')).status()).toBe(404);
});

test('the app manifest and service worker are files of this server', async ({ page }) => {
  const { request } = page;
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

test("a screen's HTML is its frame and its heading, with rows still to come and nothing of anyone's, not even the address in its path", async ({ page }) => {
  const { request } = page;
  for (const [path, heading] of [
    ['/', 'For review'],
    ['/rules', 'Rules'],
    [senderPage('ada@example.org'), null],
  ] as const) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain('aria-label="Sections"');
    expect(html, path).toContain('<footer');
    expect(html, path).toMatch(heading ? new RegExp(`<h1[^>]*>${heading}</h1>`) : /<h1[^>]*>/);
    expect(html, path).toContain('aria-busy="true"');
    for (const mine of ['example.', 'ada%40', 'Ada Lovelace', 'Replica lag', 'Lunch on Thursday']) expect(html, `${path} holds ${mine}`).not.toContain(mine);
  }
});
