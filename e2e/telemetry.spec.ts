import { SENTRY_DSN, expect, openMessage, path, senderPage, settingsFromMenu, test, ME } from './sift.ts';

test.describe('What the page sends Sentry', () => {
  test.use({ sentry: true });

  test('a load and the calls it made in one trace, a screen by its route, and nothing that names mail', async ({ page }) => {
    const sent: string[] = [];
    await page.route(`${new URL(SENTRY_DSN).origin}/**`, async (route) => {
      sent.push(route.request().postData() ?? '');
      await route.fulfill({ status: 200, body: '{}' });
    });
    // The trace each call to the API was made in.
    const traces = new Map<string, string>();
    page.on('request', (request) => {
      const trace = request.headers()['sentry-trace'];
      if (trace) traces.set(new URL(request.url()).pathname, trace.split('-')[0]!);
    });

    await page.goto('/');
    const panel = await openMessage(page, 'Lunch on Thursday?');
    await panel.getByRole('link', { name: 'All their mail' }).click();
    await path(page).toBe(senderPage('ada@example.org'));
    await expect(page.getByRole('heading', { name: 'Ada Lovelace', level: 1 })).toBeVisible();

    // For review's list was read in the page load's trace, which the server's spans for it are under.
    await expect.poll(() => traces.get('/api/suggestions')).toBeDefined();
    await expect.poll(() => sent.some((envelope) => envelope.includes(traces.get('/api/suggestions')!) && envelope.includes('"pageload"'))).toBe(true);
    await expect.poll(() => sent.join('\n')).toContain('/sender/:address');

    const all = sent.join('\n');
    for (const named of ['ada@example.org', 'ada%40example.org', ME, 'me%40example.org', 'Lunch on Thursday', '?message=', '?id=', 'account='])
      expect(all, named).not.toContain(named);
  });

  test('Settings opened over a screen is a navigation of its own, named for it, with what it asked for in its trace', async ({ page }) => {
    const sent: string[] = [];
    await page.route(`${new URL(SENTRY_DSN).origin}/**`, async (route) => {
      sent.push(route.request().postData() ?? '');
      await route.fulfill({ status: 200, body: '{}' });
    });
    const traces = new Map<string, string>();
    page.on('request', (request) => {
      const trace = request.headers()['sentry-trace'];
      if (trace) traces.set(new URL(request.url()).pathname, trace.split('-')[0]!);
    });

    await page.goto('/');
    // Only once the page's load has gone is there a client to start the panel's under.
    await expect.poll(() => sent.some((envelope) => envelope.includes('"pageload"'))).toBe(true);
    await settingsFromMenu(page);
    // The models offered are asked for by Settings alone.
    await expect.poll(() => traces.get('/api/models')).toBeDefined();
    await expect.poll(() => sent.some((envelope) => envelope.includes('"transaction":"Settings"') && envelope.includes(traces.get('/api/models')!))).toBe(true);
  });

  test('a frame of half a second or more is an error, under the screen it froze', async ({ page }) => {
    const sent: string[] = [];
    await page.route(`${new URL(SENTRY_DSN).origin}/**`, async (route) => {
      sent.push(route.request().postData() ?? '');
      await route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/');
    await expect.poll(() => sent.some((envelope) => envelope.includes('"pageload"'))).toBe(true);
    // Work that holds the page for most of a second, as drawing a long list in one go can.
    await page.evaluate('void requestAnimationFrame(() => { const end = performance.now() + 700; while (performance.now() < end); })');
    // A long frame is reported once the page is idle again, and sent after.
    await expect.poll(() => sent.find((envelope) => envelope.includes('The page froze for')), { timeout: 15_000 }).toContain('"screen":"/"');
  });
});

test.describe('What an Inbox opened again sends Sentry', () => {
  test.use({ sentry: true, variant: 'inbox' });

  test('its load named for it, with the frame and the copy read from the device, each call by its path, and when its rows were shown', async ({ page }) => {
    const sent: string[] = [];
    await page.route(`${new URL(SENTRY_DSN).origin}/**`, async (route) => {
      sent.push(route.request().postData() ?? '');
      await route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    // Kept on the device for the next time, which is the open timed.
    await expect.poll(() => sent.some((envelope) => envelope.includes('"Inbox rows"'))).toBe(true);
    sent.length = 0;
    await page.reload();

    const named = (name: string) => () => sent.some((envelope) => envelope.includes(`"name":"${name}"`));
    for (const name of ['/inbox', 'Frame from the device', 'Copy read', "Copy's first screen", 'Inbox rows', 'GET /api/session', 'GET /api/sync'])
      await expect.poll(named(name), name).toBe(true);
    expect(sent.join('\n')).not.toContain('"name":"GET 127.0.0.1"');
  });
});
