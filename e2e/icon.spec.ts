import type { Page } from '@playwright/test';
import { expect, test } from './fixture.ts';
import { forReviewLink } from './navigation.ts';
import { row } from './parts.ts';
import { toast } from './toast.ts';
import { inboxRows } from './inbox.ts';

/**
 * What the page last put on the app's icon, as `window.badge` (a count, or null once cleared), and how often it asked to
 * allow notifications, as `window.asked`, answered `answer`. `iPhone` makes it Safari's Home Screen app.
 */
const device = ({ answer, iPhone }: { answer: 'granted' | 'denied'; iPhone: boolean }) => `
  window.asked = 0;
  let now = 'default';
  Object.defineProperty(navigator, 'setAppBadge', { value: (count) => ((window.badge = count), Promise.resolve()) });
  Object.defineProperty(navigator, 'clearAppBadge', { value: () => ((window.badge = null), Promise.resolve()) });
  if (${iPhone}) Object.defineProperty(navigator, 'standalone', { value: true });
  Object.defineProperty(Notification, 'permission', { get: () => now });
  Object.defineProperty(Notification, 'requestPermission', { value: () => (window.asked++, (now = '${answer}'), Promise.resolve(now)) });`;

const badge = (page: Page) => expect.poll(() => page.evaluate('window.badge'));
const asked = (page: Page) => expect.poll(() => page.evaluate('window.asked'));

test.describe('The count on the app icon', () => {
  test('is For review’s, and goes down as mail is answered, with nothing asked on a computer', async ({ page }) => {
    await page.addInitScript(device({ answer: 'granted', iPhone: false }));
    await page.goto('/');
    await expect(forReviewLink(page)).toHaveAccessibleName('For review 12');
    await badge(page).toBe(12);

    await row(page, 'Winter sale starts now').getByRole('button', { name: 'Agree: Marketing' }).click();
    await expect(toast(page, 'Winter sale starts now')).toBeVisible();
    await badge(page).toBe(11);
    await asked(page).toBe(0);
  });

  test('an iPhone is asked on the first press, once, and shows it once allowed', async ({ page }) => {
    await page.addInitScript(device({ answer: 'granted', iPhone: true }));
    await page.goto('/');
    await expect(forReviewLink(page)).toHaveAccessibleName('For review 12');
    await badge(page).toBeUndefined();

    await row(page, 'Winter sale starts now').getByRole('button', { name: 'Agree: Marketing' }).click();
    await asked(page).toBe(1);
    await badge(page).toBe(11);
    await forReviewLink(page).click();
    await asked(page).toBe(1);
  });

  test('an iPhone that refused shows nothing, and is not asked again', async ({ page }) => {
    await page.addInitScript(device({ answer: 'denied', iPhone: true }));
    await page.goto('/');
    await forReviewLink(page).click();
    await asked(page).toBe(1);
    await forReviewLink(page).click();
    await asked(page).toBe(1);
    await badge(page).toBeUndefined();
  });
});

test.describe('The count on the app icon, with Inbox on', () => {
  test.use({ variant: 'inbox' });

  test('is the unread conversations in the inbox, as Inbox counts them', async ({ page }) => {
    await page.addInitScript(device({ answer: 'granted', iPhone: false }));
    await page.goto('/inbox?unread=1');
    await expect(inboxRows(page).first()).toBeVisible();
    await badge(page).toBe(await inboxRows(page).count());
  });
});
