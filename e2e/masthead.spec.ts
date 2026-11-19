import type { Page } from '@playwright/test';
import { expect, PHONE, patchJson, pointAt, senderPage, settings, sideScroll, test, tooltip } from './sift.ts';

test.describe('When a Google sign-in expired', () => {
  // A service worker's page is out of reach of page.route.
  test.use({ serviceWorkers: 'block' });

  test('Reconnect signs in again and comes back to the same page', async ({ page }) => {
    await patchJson(page, '**/api/manage*', (manage) => ({ ...manage, activity: { ...manage.activity, expired: ['me@example.org'] } }));
    await page.clock.install();
    await page.goto('/rules/r-1');
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    // The page came drawn with the server's own; a minute on it asks again, and gets the reply above.
    await page.clock.runFor(60_000);
    await page.clock.resume();
    await expect(page.getByRole('banner').getByText('Google sign-in expired').filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reconnect' }).filter({ visible: true })).toHaveAttribute(
      'href',
      `/auth/login?to=${encodeURIComponent('/rules/r-1')}`,
    );
  });
});

test.describe("The masthead's line", () => {
  test('says how long since Sift synced and what the model cost over 30 days, and the cost previews each window', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('banner');
    const cost = banner.getByRole('link', { name: /30D$/ }).filter({ visible: true });
    await expect(cost).toHaveText('$0 30D');
    // Read out as "Synced just now"; each mailbox's own time when pointed at. Pointed at once the cost has
    // arrived, which moves it left.
    const synced = banner.getByText(/^Synced(just now|\d+ min ago)$/).filter({ visible: true });
    await pointAt(synced);
    await expect(tooltip(page)).toHaveText(/^me@example\.org: /);
    await expect(cost).toHaveAttribute('href', '/activity');
    await expect(page.getByText(/without a model/)).toHaveCount(0);

    await pointAt(cost);
    for (const window of ['24H', '7D', '30D']) await expect(page.getByRole('term').filter({ hasText: window })).toBeVisible();
    // For review's own Today is a heading over its rows.
    await expect(page.getByText('Today', { exact: true }).and(page.locator(':not(th)'))).toBeVisible();
  });

  test('on a phone, the bar is the name, the line and the menu, and the menu shows the costs above the account', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: /30D$/ }).filter({ visible: true })).toBeVisible();
    // The page's title says where you are, right under the bar.
    await expect(banner.getByText('For review').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await sideScroll(page).toBe(0);

    await page.getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    for (const window of ['24H', '7D', '30D']) await expect(menu.getByRole('term').filter({ hasText: window })).toBeVisible();
    await expect(menu.getByText('me@example.org')).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await menu.getByRole('button', { name: 'Settings' }).click();
    await expect(settings(page)).toBeVisible();
  });
});

test.describe('The sections', () => {
  // A service worker's page is out of reach of page.route.
  test.use({ serviceWorkers: 'block' });

  test('each opens as it is pressed, without waiting on the server', async ({ page }) => {
    // Whatever is asked for on a press waits until the end, as a server starting cold would make it.
    let answer = () => {};
    const answered = new Promise<void>((done) => (answer = done));
    await page.route(/[?&]_rsc=/, async (route) => {
      if (!route.request().headers()['next-router-prefetch']) await answered;
      await route.continue();
    });
    const ahead = new Set<string>();
    page.on('requestfinished', (request) => {
      if (request.headers()['next-router-segment-prefetch']?.endsWith('__PAGE__')) ahead.add(new URL(request.url()).pathname);
    });
    await page.goto('/');
    await expect.poll(() => ['/activity', '/labels', '/rules'].filter((screen) => !ahead.has(screen))).toEqual([]);

    const sections = page.getByRole('navigation', { name: 'Sections' }).first();
    // For review last: the router keeps nothing of the screen the page opened on, so going back asks again, behind it.
    for (const name of ['Activity', 'Labels', 'Rules', 'For review']) {
      await sections.getByRole('link', { name }).click();
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    }
    answer();
  });
});

test.describe('While the reader waits', () => {
  // A service worker's page is out of reach of page.route.
  test.use({ serviceWorkers: 'block' });

  /** Holds every request matching `url` until the returned function is called. */
  async function hold(page: Page, url: string) {
    let release = () => {};
    const released = new Promise<void>((done) => (release = done));
    await page.route(url, async (route) => {
      await released;
      await route.continue();
    });
    return release;
  }

  test('the loading bar runs while a screen has none of its data, and stops when it arrives', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await expect(page.locator('.loading-bar')).toHaveCount(0);

    const release = await hold(page, '**/api/decisions?*');
    await page.getByRole('navigation', { name: 'Sections' }).first().getByRole('link', { name: 'Activity' }).click();
    await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
    await expect(page.locator('.loading-bar')).toHaveCount(1);
    release();
    await expect(page.locator('.loading-bar')).toHaveCount(0);
  });

  test("a sender's page is drawn with the name and the loading bar before the browser knows who is signed in", async ({ page }) => {
    const release = await hold(page, '**/api/session?*');
    await page.goto(senderPage('ada@example.org'));
    await expect(page.getByRole('link', { name: 'Sift' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
    await expect(page.locator('.loading-bar')).toHaveCount(1);
    release();
    await expect(page.getByRole('heading', { name: 'Ada Lovelace', level: 1 })).toBeVisible();
  });
});

test.describe("The masthead's line, after a pass with Sift on", () => {
  test.use({ variant: 'on' });

  test('the cost previews what Sift saved over each window, above what the model cost', async ({ page }) => {
    await page.goto('/');
    const cost = page.getByRole('banner').getByRole('link', { name: /30D$/ }).filter({ visible: true });
    await expect(cost).toHaveText('$0 30D');
    await pointAt(cost);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByText('Model', { exact: true })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: /^10 s$/ })).toHaveCount(3);
  });
});
