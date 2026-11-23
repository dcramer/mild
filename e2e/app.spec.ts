import type { Page } from '@playwright/test';
import { STARTUP_SCREENS, startupImage } from '../web/src/lib/startup.ts';
import {
  back,
  boxOf,
  closeSettings,
  composer,
  messageQuery,
  expect,
  forward,
  PHONE,
  patchJson,
  path,
  putAway,
  query,
  senderPage,
  settings,
  settingsFromMenu,
  test,
} from './sift.ts';

// The installed app: what the phone's own edges, its Back and its network do to the page.

const SENDER = senderPage('notifications@code.example.com');
const menu = (page: Page) => page.getByRole('dialog', { name: 'Menu' });
/** What this device keeps of the frame, by name, and whether it holds a key. */
const kept = `new Promise((done) => {
  const opening = indexedDB.open('sift-device');
  // Not made here: the page would find it made without its stores.
  opening.onupgradeneeded = () => opening.transaction.abort();
  opening.onerror = () => done({ key: 0, frame: [] });
  opening.onsuccess = () => {
    const db = opening.result;
    const reading = db.transaction(['key', 'frame']);
    const key = reading.objectStore('key').count();
    const frame = reading.objectStore('frame').getAllKeys();
    reading.oncomplete = () => (db.close(), done({ key: key.result, frame: frame.result }));
  };
})`;
const keptAll = { key: 1, frame: ['manage', 'session', 'suggestions-false', 'usage'] };

/** Drop what the device kept of the frame under `name`. */
const forget = (name: string) => `new Promise((done) => {
  indexedDB.open('sift-device').onsuccess = (event) => {
    const db = event.target.result;
    const removing = db.transaction('frame', 'readwrite');
    removing.objectStore('frame').delete('${name}');
    removing.oncomplete = () => (db.close(), done());
  };
})`;

test("the page is drawn to the screen's edges, under a status bar in its own colour, with a picture of its opening for each iPhone", async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'black-translucent');
  const pictures = page.locator('link[rel="apple-touch-startup-image"]');
  await expect(pictures).toHaveCount(STARTUP_SCREENS.length);
  for (const screen of STARTUP_SCREENS) {
    const reply = await page.request.get(startupImage(screen));
    expect(reply.headers()['content-type'], startupImage(screen)).toBe('image/png');
  }
  // Pulling down from the top does not reload the page on Android.
  expect(await page.evaluate<string>('getComputedStyle(document.documentElement).overscrollBehaviorY')).toBe('none');

  const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as { start_url: string; shortcuts: { name: string; url: string }[] };
  expect(manifest.start_url).toBe('/?start=1');
  expect(manifest.shortcuts.map((s) => s.name)).toEqual(['For review', 'Inbox', 'New message', 'Activity']);
});

test.describe('On a phone with a notch', () => {
  test.use({ viewport: PHONE });

  /** The status bar and the home indicator, as an iPhone's installed app has them. */
  const notched = (page: Page) => page.addStyleTag({ content: ':root { --safe-top: 47px !important; --safe-bottom: 34px !important; }' });

  test('the top bar, the menu, a panel, a dialog and the reader start below the status bar, the bar a gutter below it', async ({ page }) => {
    await page.goto('/rules');
    await notched(page);
    const below = async (what: Parameters<typeof boxOf>[0]) => expect((await boxOf(what)).y).toBeGreaterThanOrEqual(47);
    // iOS fades what is just under the status bar, so the bar's field stands the page's gutter below it.
    expect((await boxOf(page.getByRole('button', { name: 'Menu' }))).y).toBeGreaterThanOrEqual(47 + 16);

    await page.getByRole('button', { name: 'Menu' }).click();
    await below(menu(page).getByRole('button', { name: 'Close menu' }));
    await menu(page).getByRole('button', { name: 'Settings' }).click();
    await below(settings(page).getByRole('heading', { name: 'Settings' }));
    await below(settings(page).getByRole('button', { name: 'Close' }));
    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(settings(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await below(dialog.getByRole('button', { name: 'Close' }));

    await page.goto(`/?${messageQuery('m6')}`);
    await notched(page);
    await expect(back(page)).toBeVisible();
    await page.evaluate('scrollTo(0, 0)');
    await below(back(page));
  });
});

test.describe("The phone's Back", () => {
  test.use({ viewport: PHONE });

  test("closes the menu, and a section pressed in it takes the menu's place in history", async ({ page }) => {
    await page.goto('/');
    await page.goto('/activity');
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(menu(page)).toBeVisible();
    await page.goBack();
    await expect(menu(page)).toHaveCount(0);
    await path(page).toBe('/activity');

    await page.getByRole('button', { name: 'Menu' }).click();
    await menu(page).getByRole('link', { name: 'Rules' }).click();
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await page.goBack();
    await path(page).toBe('/');
  });

  test('closes a dialog, and closing one leaves nothing behind for Back', async ({ page }) => {
    await page.goto('/');
    await page.goto('/rules');
    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await path(page).toBe('/rules');

    // Its next step is another dialog in the same place: one entry for both.
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Value 1' })).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await path(page).toBe('/rules');

    await page.getByRole('button', { name: 'Add a rule' }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await page.goBack();
    await path(page).toBe('/');
  });
});

test.describe('When drawing the page fails', () => {
  test.use({ serviceWorkers: 'block', allow: ["reading 'expired'"] });

  test('it says so, and Reload loads it again', async ({ page }) => {
    await patchJson(page, '**/api/manage*', (manage) => ({ ...manage, activity: null }));
    await page.goto(SENDER);
    await expect(page.getByRole('heading', { name: 'Something went wrong.' })).toBeVisible();
    await page.unrouteAll();
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('heading', { name: 'notifications@code.example.com' })).toBeVisible();
  });
});

test.describe('After Mild is updated under an open page', () => {
  test.use({ serviceWorkers: 'block' });

  /** Mild answers as another build than the page's, as after a deploy. */
  const deployed = (page: Page) =>
    page.route('**/api/**', async (route) => {
      const response = await forward(route);
      await route.fulfill({ response, headers: { ...response.headers(), 'x-sift-build': 'a-newer-build' } });
    });
  /** Opened before the deploy and seen since, so it is past the seconds in which it would load itself again at once. */
  async function openBefore(page: Page) {
    await page.clock.install();
    await page.goto(SENDER);
    await expect(page.getByRole('heading', { name: 'notifications@code.example.com' })).toBeVisible();
    await page.clock.runFor(10_000);
    await page.evaluate('window.stayed = true');
    await deployed(page);
  }
  const reloaded = (page: Page) => page.evaluate<boolean>("!('stayed' in window)").catch(() => false);
  const IDLE = 10 * 60_000;

  test('put away, it loads itself again as the new build', async ({ page }) => {
    await openBefore(page);
    // In view, it carries on until the person switches away.
    const asked = page.waitForResponse('**/api/**');
    await page.clock.runFor(60_000);
    await asked;
    expect(await reloaded(page)).toBe(false);
    await expect
      .poll(async () => {
        await page.clock.runFor(30_000);
        await putAway(page);
        return reloaded(page);
      })
      .toBe(true);
    await page.clock.resume();
    await expect(page.getByRole('heading', { name: 'notifications@code.example.com' })).toBeVisible();
  });

  test('left untouched in view, it loads itself again, but not while a dialog is open over it', async ({ page }) => {
    await openBefore(page);
    await settingsFromMenu(page);
    for (let tried = 0; tried < 3; tried++) {
      const asked = page.waitForResponse('**/api/**');
      await page.clock.runFor(IDLE);
      await asked;
    }
    expect(await reloaded(page)).toBe(false);
    await closeSettings(page);
    await expect.poll(async () => (await page.clock.runFor(IDLE), reloaded(page))).toBe(true);
    await page.clock.resume();
    await expect(page.getByRole('heading', { name: 'notifications@code.example.com' })).toBeVisible();
  });

  test('the next screen gone to is loaded whole, from the new build', async ({ page }) => {
    await deployed(page);
    await page.goto(SENDER);
    // Just opened, it loads itself again once as the newer build, which may be after the screen was drawn from the device.
    await expect.poll(() => page.evaluate<string>("performance.getEntriesByType('navigation')[0].type").catch(() => 'loading')).toBe('reload');
    await expect(page.getByRole('heading', { name: 'notifications@code.example.com' })).toBeVisible();
    await page.evaluate('window.stayed = true');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Rules' }).click();
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    expect(await page.evaluate<boolean>("'stayed' in window")).toBe(false);
  });

  test('not while it is the same build: going between screens loads nothing', async ({ page }) => {
    await page.goto(SENDER);
    await expect(page.getByRole('heading', { name: 'notifications@code.example.com' })).toBeVisible();
    await page.evaluate('window.stayed = true');
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Rules' }).click();
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    expect(await page.evaluate<boolean>("'stayed' in window")).toBe(true);
  });
});

test.describe('Started without a network', () => {
  // What the page asked for while there was none: from the network, or through the worker, for a file it had not kept yet.
  test.use({ allow: ['ERR_INTERNET_DISCONNECTED', 'net::ERR_FAILED'] });

  /** The worker in charge, with the page it stands in with kept. */
  async function installed(page: Page) {
    await page.goto('/sender');
    await expect.poll(() => page.evaluate<boolean>('navigator.serviceWorker.controller !== null')).toBe(true);
  }

  test('says it is offline, keeps no mail, and opens the page asked for once the network is back', async ({ page, context }) => {
    await installed(page);
    await context.setOffline(true);
    await page.goto('/rules');
    await expect(page.getByRole('heading', { name: "You're offline." })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible();
    await path(page).toBe('/rules');
  });

  test('a page that does not come stands in with the one kept, and loads once Mild answers', async ({ page, context }) => {
    test.slow();
    await installed(page);
    let held = true;
    await context.route('**/labels', async (route) => {
      // Never answered, the first time: a network that connects and says nothing.
      if (held) {
        held = false;
        return;
      }
      await route.continue();
    });
    await page.goto('/labels');
    await expect(page.getByRole('heading', { name: 'Labels', level: 1 })).toBeVisible({ timeout: 20_000 });
    expect(held).toBe(false);
  });
});

test.describe('The installed app', () => {
  test.describe('with Inbox on', () => {
    test.use({ variant: 'inbox' });

    test('opens on Inbox, the first time and after', async ({ page }) => {
      await page.goto('/?start=1');
      await path(page).toBe('/inbox');
      await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
      await page.goto('/?start=1');
      await path(page).toBe('/inbox');
    });

    test("keeps each person's drafts apart, and forgets them on sign-out", async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() =>
        localStorage.setItem(
          'sift:draft:someone@example.net:new',
          JSON.stringify({ from: '', to: '', cc: '', showCc: false, subject: '', text: 'Not mine', id: null }),
        ),
      );
      await page.getByRole('button', { name: /Compose/ }).click();
      const writing = composer(page, 'New message');
      await expect(writing.getByRole('textbox', { name: 'Message' })).toHaveValue('');
      await writing.getByRole('textbox', { name: 'Message' }).fill('Mine');
      await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('sift:draft:')).length)).toBe(2);
      await writing.getByRole('button', { name: 'Close' }).click();
      await expect(writing).toHaveCount(0);

      await page.getByRole('button', { name: /^Account, / }).click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
      await expect(page.getByRole('button', { name: /^Account, / })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => /^sift:(draft:|mailbox|start)/.test(key)))).toEqual([]);
    });
  });

  test('opens on the frame this device kept before Mild answers, and asks Mild all the same', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await expect.poll(() => page.evaluate(kept)).toEqual(keptAll);
    const waiting: (() => Promise<void>)[] = [];
    await page.route('**/api/session*', (route) => void waiting.push(() => route.continue()));
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Account, / })).toBeVisible();
    await expect.poll(() => waiting.length).toBeGreaterThan(0);
    await Promise.all(waiting.map((answer) => answer()));
  });

  test('a device Mild no longer knows is wiped, and made again', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(kept)).toEqual(keptAll);
    const made: string[] = [];
    page.on('request', (request) => void (request.method() === 'POST' && new URL(request.url()).pathname === '/api/device' && made.push(request.url())));
    await page.context().clearCookies({ name: 'sift_device' });
    await page.reload();
    await expect.poll(() => made.length).toBe(1);
    await expect.poll(() => page.evaluate(kept)).toEqual(keptAll);
  });

  test.describe('signed out elsewhere', () => {
    // The frame kept says who was signed in, so the screen asks for its list before Mild says nobody is.
    test.use({ allow: ['status of 401'] });

    test('the sign-in screen replaces the frame kept, and nothing of theirs is left', async ({ page }) => {
      await page.goto('/');
      await expect.poll(() => page.evaluate(kept)).toEqual(keptAll);
      await page.context().clearCookies({ name: 'sift_session' });
      await page.reload();
      await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
      await expect.poll(() => page.evaluate<string[]>('indexedDB.databases().then((all) => all.map((d) => d.name))')).not.toContain('sift-device');
    });
  });

  test('opens on For review while Inbox is off', async ({ page }) => {
    await page.goto('/?start=1');
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await query(page).toBe('');
    await page.goto('/?start=1');
    await path(page).toBe('/');
    await query(page).toBe('');
  });
});

test.describe('A reload', () => {
  test.use({ viewport: PHONE, serviceWorkers: 'block' });

  test('comes back to where the list was', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('row').nth(8)).toBeVisible();
    // The last of the page to come, above the list: scrolled before it, the browser moves the page down when it comes.
    await expect(page.getByText(/it would have kept/)).toBeVisible();
    await page.evaluate('scrollTo(0, 600)');
    // What Mild would have saved, which "Mild is off" says above the list, is not on the device yet, as when the page was
    // left before it was kept or a deploy since dropped it, and Mild answers it only once the place is given back.
    await expect.poll(() => page.evaluate(kept)).toEqual(keptAll);
    await page.evaluate(forget('usage'));
    const { promise: answered, resolve: answer } = Promise.withResolvers<void>();
    await page.route('**/api/usage*', async (route) => {
      await answered;
      await route.continue();
    });
    await page.reload();
    // The list is fetched after the page loads: the browser's own restoring finds the page too short.
    await expect.poll(() => page.evaluate<number>('Math.round(scrollY)')).toBe(600);
    answer();
    await expect(page.getByText(/^On, it would have kept/)).toBeVisible();
    expect(await page.evaluate<number>('Math.round(scrollY)')).toBe(600);
    await expect(page.getByRole('row').nth(8)).toBeVisible();
  });
});
