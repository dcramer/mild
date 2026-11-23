import type { Locator, Page } from '@playwright/test';
import { PHONE, boxOf, expect, forward, param, patchJson, reader, sideScroll, test, toast } from './sift.ts';

/** The phone's top bar. */
const bar = (page: Page) => page.getByRole('banner');
/** Inbox's conversations, by when each came: the only rows with a time in them. */
const conversations = (page: Page) => page.getByRole('row').filter({ hasText: /\d:\d\d [AP]M/ });

/** What `lengthened` puts in front of a sender's domain: a list's sending host, with nowhere to break a line. */
const LONG = 'em7731.bounces.notifications-mailer.';
const MINE = new Set(['me@example.org', 'me@work.example.org', 'example.org', 'work.example.org']);

/** `json` with every sender's address and domain as long as a mailing list's (a bounce address, a sending host); the account's own are left. */
function lengthened(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(lengthened);
  if (typeof json === 'object' && json !== null) return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, lengthened(v)]));
  if (typeof json !== 'string' || MINE.has(json)) return json;
  const address = /^([^\s@/]+)@([a-z0-9.-]+\.[a-z]+)$/.exec(json);
  if (address) return `${address[1]}+bounce-2f8a91c04e6b7d35a1c9e2f0b84d6a7e@${LONG}${address[2]}`;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net)$/.test(json) ? `${LONG}${json}` : json;
}

/** How many of `rows` are wholly on the first screen. */
async function onFirstScreen(rows: Locator) {
  let whole = 0;
  for (const row of await rows.all()) {
    const box = await boxOf(row);
    if (box.y >= 0 && box.y + box.height <= PHONE.height) whole += 1;
  }
  return whole;
}

test.describe('On a phone', () => {
  test.use({ variant: 'inbox', viewport: PHONE });

  test("Inbox's first screen holds seven conversations or more, under a bar that is its search", async ({ page }) => {
    await page.goto('/inbox');
    await expect(conversations(page).first()).toBeVisible();
    expect(await onFirstScreen(conversations(page))).toBeGreaterThanOrEqual(7);
    await sideScroll(page).toBe(0);

    const search = bar(page).getByRole('searchbox', { name: 'Search mail' });
    await expect(bar(page).getByRole('button', { name: 'Menu' })).toBeVisible();
    await search.fill('1042');
    await expect(conversations(page)).toHaveCount(1);
    await expect(conversations(page)).toContainText('Your order has shipped');
    await search.fill('');

    // The views are a menu on the list's name.
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Everything' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio', { name: 'Sorted' }).click();
    await param(page, 'view').toBe('sorted');
    await expect(page.getByRole('button', { name: 'Show' })).toContainText('InboxSorted');
  });

  test('the bar goes as the page scrolls down and comes back as it scrolls up, and the day stays under it', async ({ page }) => {
    await page.goto('/inbox');
    await expect(conversations(page).first()).toBeVisible();
    const today = page.getByRole('columnheader', { name: 'Today' });

    await page.mouse.wheel(0, 500);
    await expect
      .poll(async () => {
        const box = await boxOf(bar(page));
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(0);
    await expect.poll(async () => (await boxOf(today)).y).toBe(0);

    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await boxOf(bar(page))).y).toBe(0);
    const height = (await boxOf(bar(page))).height;
    await expect.poll(async () => (await boxOf(today)).y).toBe(height);
  });

  test('no screen scrolls sideways, even with addresses and domains as long as a mailing list sends', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const response = await forward(route);
      if (!(response.headers()['content-type'] ?? '').includes('json')) return route.fulfill({ response });
      await route.fulfill({ response, json: lengthened(await response.json()) });
    });
    const screens = [
      '/',
      '/inbox',
      '/rules',
      '/sender/deals%40promo.example.com',
      '/domain/promo.example.com',
      '/inbox?message=m4&account=me%40example.org',
      '/?message=m8&account=me%40example.org',
    ];
    for (const screen of screens)
      await test.step(screen, async () => {
        await page.goto(screen);
        await expect(page.getByText(LONG).filter({ visible: true }).first()).toBeVisible();
        await sideScroll(page).toBe(0);
      });
  });

  test('a phone on its side keeps the layout of a phone', async ({ page }) => {
    await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
    await page.goto('/inbox');
    await expect(bar(page).getByRole('searchbox', { name: 'Search mail' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
    await sideScroll(page).toBe(0);
  });

  test('a conversation opens with no bar above it, its subject at reading size, its text on the first screen and the mailbox it came to in full', async ({
    page,
  }) => {
    // Sent to the account and someone else, so who it went to is said.
    await patchJson(page, '**/api/message?*', (detail) => ({
      ...detail,
      to: [
        { address: 'me@example.org', name: null },
        { address: 'grace@example.net', name: null },
      ],
    }));
    await page.goto('/inbox');
    await conversations(page).filter({ hasText: 'Your March bill' }).click();
    const open = reader(page);
    const subject = open.getByRole('heading', { name: 'Your March bill', level: 1 });
    await expect(subject).toHaveCSS('font-size', '17px');
    await expect(bar(page)).toHaveCount(0);
    // Each head says when, short: no year this year.
    await expect(open.locator('header time').first()).toHaveText(/^([A-Z][a-z]{2} \d{1,2}, )?\d{1,2}:\d\d [AP]M$/);
    // With two mailboxes, which of them it came to is named in full, first.
    await expect(open.getByText(/^To\s+me@example\.org, grace@example\.net$/).first()).toBeVisible();

    // Measured once the conversation is drawn: the text of its first message.
    const text = open.getByRole('article').first().getByText('Your bill is ready.');
    const box = await boxOf(text);
    expect(box.y + box.height).toBeLessThan(PHONE.height / 2);
  });

  test('archiving from the reader says so in one line, above the presses at the bottom', async ({ page }) => {
    await page.goto('/inbox');
    await conversations(page).filter({ hasText: 'Your March bill' }).click();
    const archive = reader(page).getByRole('button', { name: 'Archive', exact: true });
    await archive.click();
    const said = toast(page, 'Your March bill');
    await expect(said).toBeVisible();
    const box = await boxOf(said);
    expect(box.height).toBeLessThan(64);
    expect(box.y + box.height).toBeLessThanOrEqual((await boxOf(archive)).y);
    await expect(said.getByRole('button', { name: /^Undo/ })).toBeVisible();
  });
});

// With Inbox off, so For review, which says Mild is off, is what the page opens on: with it on, the page goes on to Inbox.
test.describe('On a phone, with Inbox off', () => {
  test.use({ viewport: PHONE });

  test("Mild's line is in the menu and on Activity, and Mild is off is said in full", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Nothing here has been done in Gmail.', { exact: false })).toBeVisible();
    await expect(bar(page).getByRole('link', { name: /30D$/ })).toHaveCount(0);
    await bar(page).getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: /30D$/ })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/activity');
    await expect(page.getByRole('link', { name: /30D$/ }).filter({ visible: true })).toBeVisible();
  });
});
