import { AxeBuilder } from '@axe-core/playwright';
import { PAGE_HEADERS } from '../src/dashboard/policy.ts';
import type { Session } from '../src/dashboard/types.ts';
import { HELD, expect, test, PHONE } from './fixture.ts';
import { boxOf, forget, frameKept, settled, shifts, sideScroll, watchShifts } from './wait.ts';
import { domainPage, senderPage } from './navigation.ts';

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

test('every screen calls it Mild, and only its wordmark mild', async ({ page }) => {
  for (const [path, heading] of [
    ['/', 'For review'],
    ['/contacts', 'Contacts'],
    ['/activity', 'Activity'],
    ['/labels', 'Labels'],
    ['/rules', 'Rules'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    // A word of its own: a command, a path or a Gmail label (`mild/digest`) keeps its spelling.
    await expect(page.locator('main'), path).not.toContainText(/(?<![\w/.@~$-])sift(?![\w/.@-])/);
    // On a desktop the rail draws the icon in place of the name.
    await expect(page.getByRole('link', { name: 'Mild', exact: true }).filter({ visible: true }), path).toHaveCount(1);
    await expect(
      page
        .locator('.wordmark')
        .filter({ visible: true })
        .filter({ hasNotText: /^mild$/ }),
      path,
    ).toHaveCount(0);
    await expect(page.locator('[aria-label="mild"]'), path).toHaveCount(0);
  }
});

const SCREENS = [
  ['/', 'For review'],
  ['/inbox', 'Inbox'],
  ['/contacts', 'Contacts'],
  ['/activity', 'Activity'],
  ['/labels', 'Labels'],
  ['/rules', 'Rules'],
] as const;
const COMPUTER = { width: 1280, height: 800 };

for (const [where, viewport] of [
  ['on a computer', COMPUTER],
  ['on a phone', PHONE],
] as const) {
  test(`every screen passes axe's accessibility checks, ${where}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const [path, heading] of SCREENS) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations.flatMap((v) => v.nodes.map((n) => `${path} ${v.id}: ${n.failureSummary ?? ''} ${n.html}`)),
        path,
      ).toEqual([]);
    }
  });

  // Contacts and Activity are left out until their first draw is as tall as what replaces it (TODO.md).
  test(`opened again, nothing on a screen moves once it is drawn, ${where}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await watchShifts(page);
    for (const [path, heading] of SCREENS.filter(([path]) => path !== '/contacts' && path !== '/activity')) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      // The first screen keeps the frame, with no request after it: on a busy machine the network can be quiet before
      // the page has asked for anything.
      await frameKept(page);
      await page.waitForLoadState('networkidle');
      await page.reload();
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await shifts(page), path).toEqual([]);
    }
  });
}

test("Mild's line comes into the room the rail's foot held for it, when the device had not kept it", async ({ page }) => {
  await page.setViewportSize(COMPUTER);
  await watchShifts(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
  await frameKept(page);
  await page.evaluate(forget('manage'));
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  await page.route('**/api/manage*', async (route) => {
    await held;
    await route.continue();
  });
  await page.reload();
  await expect(page.getByRole('button', { name: /^Account, / })).toBeVisible();
  await settled(page);
  release();
  await expect(page.getByText('30D')).toBeVisible();
  expect(await shifts(page)).toEqual([]);
});

test('under reduced motion nothing moves: a layer is in place at once', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const moving = 'document.getAnimations().filter((a) => a.effect.getComputedTiming().duration > 0).length';
  expect(await page.evaluate<number>(moving)).toBe(0);
});

test('each screen is an address of its own, and anything else is missing', async ({ page }) => {
  const { request } = page;
  for (const path of [
    '/',
    '/contacts',
    '/activity',
    '/labels',
    '/rules',
    '/rules?q=digest&message=a',
    '/system',
    '/privacy',
    '/sender/news%40example.com',
    '/domain/example.com',
    '/rules/r-1',
    '/labels/newsletter',
  ]) {
    const page = await request.get(path);
    expect(page.status(), path).toBe(200);
    expect(page.headers()['content-type']).toContain('text/html');
    expect(page.headers()['content-security-policy']).toBe(PAGE_HEADERS['content-security-policy']);
  }
  for (const path of ['/settings/accounts', '/decisions', '/rules.json', '/.well-known/workflow/v1/nothing', '/sender/news%40example.com/more'])
    expect((await request.get(path)).status(), path).toBe(404);
  expect((await request.get('/api/rules/nope')).status()).toBe(404);
  expect((await request.get('/_next/static/missing.js')).status()).toBe(404);
  // Nothing uses next/image, and Mild makes no Workflow webhook.
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

test('the service worker keeps only the built files a page it keeps names', async ({ page }) => {
  /** Every path the worker keeps. */
  const kept = () =>
    page.evaluate<string[]>(`(async () => {
      const paths = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
      return paths;
    })()`);
  // Kept: drawn the same for everyone, and what a screen not kept falls back to offline.
  await page.goto('/sender');
  await expect.poll(() => page.evaluate('navigator.serviceWorker.controller !== null')).toBe(true);
  // Loaded again through the worker, which keeps the page's files as they come.
  await page.reload();
  const chunks = async () => (await kept()).filter((path) => path.startsWith('/_next/static/chunks/'));
  await expect.poll(async () => (await chunks()).length).toBeGreaterThan(0);
  // What the page as served names. Next also prefetches other screens' files, which are kept until a prune drops them.
  const html = await (await page.request.get('/sender')).text();
  const current = (await kept()).filter((path) => path === '/sender' || html.includes(path));
  // What an older build of Mild left.
  await page.evaluate(`(async () => (await caches.open((await caches.keys())[0])).put('/_next/static/chunks/older-build.js', new Response('')))()`);
  await expect.poll(kept).toContain('/_next/static/chunks/older-build.js');

  await page.reload();
  await expect.poll(kept).not.toContain('/_next/static/chunks/older-build.js');
  // The page itself is put back as it loads, after the older build's files are gone.
  await expect.poll(kept).toEqual(expect.arrayContaining(current));
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

test("a screen's HTML is the same for everyone, so the service worker can keep it: nothing of anyone's, and which build it is", async ({ page }) => {
  const { request } = page;
  const held = JSON.parse(process.env[HELD] ?? '[]') as string[];
  expect(held).toEqual(expect.arrayContaining(['Ada Lovelace', 'ada@example.org', 'Replica lag on db-3']));
  const session = (await (await request.get('/api/session')).json()) as Session;
  for (const path of ['/', '/contacts', '/activity', '/labels', '/rules', senderPage('ada@example.org'), domainPage('code.example.com')]) {
    const response = await request.get(path);
    const html = await response.text();
    expect(html, path).not.toContain(session.email!);
    for (const value of held) for (const form of new Set([value, encodeURIComponent(value)])) expect(html, `${path} holds ${form}`).not.toContain(form);
    expect(response.headers()['x-sift-build'], path).toBeTruthy();
  }
});

test.describe('signed out', () => {
  test.use({ signedOut: true });

  test('the sign-in page draws the rope over its line', async ({ page }) => {
    await page.goto('/');
    const line = page.getByRole('heading', { name: 'Your inbox, without the pesky salespeople.', level: 1 });
    const drawing = page.getByRole('main').locator('svg');
    await expect(drawing).toBeVisible();
    const box = await boxOf(drawing);
    expect(box.y + box.height).toBeLessThanOrEqual((await boxOf(line)).y);
  });

  test.describe('On a phone', () => {
    test.use({ viewport: PHONE });

    test('the rope on the sign-in page fits the screen, and the button stays under the thumb', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('main').locator('svg')).toBeVisible();
      await sideScroll(page).toBe(0);
      const button = await boxOf(page.getByRole('link', { name: 'Sign in with Google' }));
      expect(button.y + button.height).toBeLessThanOrEqual(PHONE.height);
    });
  });
});
