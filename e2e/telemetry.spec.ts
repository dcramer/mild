import { SENTRY_DSN, expect, openMessage, path, senderPage, test } from './sift.ts';

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
    for (const named of ['ada@example.org', 'ada%40example.org', 'me@example.org', 'me%40example.org', 'Lunch on Thursday', '?message=', '?id=', 'account='])
      expect(all, named).not.toContain(named);
  });
});
