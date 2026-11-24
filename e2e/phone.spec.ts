import type { Locator, Page } from '@playwright/test';
import { expect, test, PHONE } from './fixture.ts';
import { boxOf, param, path, sideScroll } from './wait.ts';
import { addressed, reader } from './reader.ts';
import { phoneMenu, sections } from './navigation.ts';
import { toast } from './toast.ts';
import { forward, patchJson } from './network.ts';
import { ME } from './mailboxes.ts';

/** The phone's top bar. */
const bar = (page: Page) => page.getByRole('banner');
/** Inbox's conversations, by when each came: the only rows with a time in them. */
const conversations = (page: Page) => page.getByRole('row').filter({ hasText: /\d:\d\d [AP]M/ });

/** What `lengthened` puts in front of a sender's domain: a list's sending host, with nowhere to break a line. */
const LONG = 'em7731.bounces.notifications-mailer.';
const MINE = new Set([ME, 'me@work.example.org', 'example.org', 'work.example.org']);

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
    await bar(page).getByRole('button', { name: 'Back' }).click();

    // The views are tabs under the bar.
    const views = page.getByRole('radiogroup', { name: 'Show' });
    await expect(views.getByRole('radio', { name: 'Everything' })).toBeChecked();
    await views.getByRole('radio', { name: 'Sorted' }).click();
    await param(page, 'view').toBe('sorted');
    await expect(views.getByRole('radio', { name: 'Sorted' })).toBeChecked();
  });

  test('pressing the search makes it a screen of its own: the filters, then what it finds, and Back leaves it', async ({ page }) => {
    await page.goto('/inbox');
    await expect(conversations(page).first()).toBeVisible();
    const search = bar(page).getByRole('searchbox', { name: 'Search mail' });
    const leave = bar(page).getByRole('button', { name: 'Back' });
    const filters = page.getByRole('complementary', { name: 'Filters' });
    const suggestion = page.getByRole('row').filter({ hasText: 'Keep Receipts from' });
    await expect(suggestion).toBeVisible();

    await search.click();
    await expect(leave).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Menu' })).toBeHidden();
    await expect(filters.getByRole('group', { name: 'Label' })).toBeVisible();
    // Nothing else of the page around it.
    await expect(page.getByRole('radiogroup', { name: 'Show' })).toBeHidden();
    await expect(sections(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Compose' })).toBeHidden();
    await expect(suggestion).toBeHidden();

    await search.fill('1042');
    await expect(filters).toHaveCount(0);
    await expect(conversations(page)).toHaveCount(1);
    await leave.click();
    await expect(search).toHaveValue('');
    await expect(bar(page).getByRole('button', { name: 'Menu' })).toBeVisible();
    await expect(sections(page)).toBeVisible();
    await expect(suggestion).toBeVisible();

    // The browser's Back leaves it as well, and stays on Inbox.
    await search.click();
    await expect(leave).toBeVisible();
    await page.goBack();
    await expect(bar(page).getByRole('button', { name: 'Menu' })).toBeVisible();
    await path(page).toBe('/inbox');
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
    // The tab bar's: the rail is not drawn.
    await expect(sections(page)).toHaveCount(1);
    await expect(sections(page).getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
    await sideScroll(page).toBe(0);
  });

  test('a conversation opens with no bar above it, its subject at reading size, its text on the first screen and the account as me', async ({ page }) => {
    // Sent to the account and someone else, so who it went to is said.
    await patchJson(page, '**/api/message?*', (detail) => ({
      ...detail,
      to: [
        { address: ME, name: null },
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
    await expect(addressed(open, 'To').first()).toHaveText(`${ME}, grace@example.net`);

    // Measured once the conversation is drawn: the text of its first message.
    const text = open.getByRole('article').first().getByText('Your bill is ready.');
    const box = await boxOf(text);
    expect(box.y + box.height).toBeLessThan(PHONE.height / 2);
  });

  test('archiving from the reader says so in one line, what was done and Undo, flush on the presses at the bottom', async ({ page }) => {
    await page.goto('/inbox');
    await conversations(page).filter({ hasText: 'Your March bill' }).click();
    const archive = reader(page).getByRole('button', { name: 'Archive', exact: true });
    await archive.click();
    const said = toast(page, 'Your March bill');
    await expect(said).toBeVisible();
    await expect(said).toContainText('Archived');
    const box = await boxOf(said);
    // One line, the width of the screen, lying on the presses rather than floating over the list.
    expect(box.height).toBeLessThan(56);
    expect(box.width).toBe(PHONE.width);
    expect(Math.abs((await boxOf(archive)).y - (box.y + box.height))).toBeLessThanOrEqual(2);
    // What was done leads it: the subject is for a screen reader, the conversation that just left being the context.
    expect((await boxOf(said.getByText('Archived'))).x - box.x).toBeLessThan(48);
  });
});

// With Inbox off, so For review, which says Mild is off, is what the page opens on: with it on, the page goes on to Inbox.
/** Counts the page's view transitions in `window.moved`: the reader's slide on a phone. */
const COUNT_MOVES = `window.moved = 0;
const start = document.startViewTransition.bind(document);
document.startViewTransition = (update) => (window.moved++, start(update));`;

test.describe('The reader’s slide', () => {
  test.use({ variant: 'inbox' });

  for (const [where, viewport, reducedMotion, moves] of [
    ['on a phone, slides in over the list and out on Back', PHONE, 'no-preference', 2],
    ['on a phone that asks for less motion, does not move', PHONE, 'reduce', 0],
    ['on a computer, does not move', { width: 1280, height: 800 }, 'no-preference', 0],
  ] as const)
    test(where, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(COUNT_MOVES);
      await page.goto('/inbox');
      await conversations(page).filter({ hasText: 'Lunch on Thursday?' }).click();
      await expect(reader(page).getByText('Are you free for lunch on Thursday?')).toBeVisible();
      await reader(page).getByRole('button', { name: 'Back' }).first().click();
      await expect(reader(page)).toHaveCount(0);
      await expect(conversations(page).filter({ hasText: 'Lunch on Thursday?' })).toBeVisible();
      expect(await page.evaluate('window.moved')).toBe(moves);
    });
});

test.describe('On a phone, with Inbox off', () => {
  test.use({ viewport: PHONE });

  test("Mild's line is in the menu and on Activity, and Mild is off is said in full", async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Nothing here has been done in Gmail.', { exact: false })).toBeVisible();
    await expect(bar(page).getByRole('link', { name: /30D$/ })).toHaveCount(0);
    await bar(page).getByRole('button', { name: 'Menu' }).click();
    await expect(phoneMenu(page).getByRole('link', { name: /30D$/ })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto('/activity');
    await expect(page.getByRole('link', { name: /30D$/ }).filter({ visible: true })).toBeVisible();
  });
});
