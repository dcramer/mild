import { TOUCH, boxOf, dismiss, expect, hold, path, reader, swipe, test, toast } from './sift.ts';
import type { Page } from '@playwright/test';

/** A conversation's row in Inbox on a phone, where it has no check to find it by. */
const row = (page: Page, subject: string) => page.getByRole('row').filter({ hasText: subject });
const idOf = async (page: Page, subject: string) => (await row(page, subject).getAttribute('data-holds'))!.split('/')[1]!;

test.describe('Inbox by touch, on a phone', () => {
  test.use({ variant: 'inbox', ...TOUCH });

  test('a row swiped left to the edge is archived once its toast goes, and Undo before then puts it back', async ({ page, sift }) => {
    await page.goto('/inbox');
    const id = await idOf(page, 'Your order has shipped');
    await swipe(row(page, 'Your order has shipped'), -380);
    await expect(row(page, 'Your order has shipped')).toHaveCount(0);
    await toast(page, 'Your order has shipped').getByRole('button', { name: /^Undo/ }).tap();
    await expect(row(page, 'Your order has shipped')).toBeVisible();
    expect(sift.google().mailbox('me@example.org').message(id)!.labelIds).toContain('INBOX');

    await swipe(row(page, 'Your order has shipped'), -380);
    await dismiss(page, 'Your order has shipped');
    await expect.poll(() => sift.google().mailbox('me@example.org').message(id)!.labelIds).not.toContain('INBOX');
    await expect(row(page, 'Your order has shipped')).toHaveCount(0);
  });

  test('a short swipe stops with its press showing; a press on the row then closes it and opens nothing, and the press archives', async ({ page }) => {
    await page.goto('/inbox');
    const shipped = row(page, 'Your order has shipped');
    const archive = shipped.getByRole('button', { name: 'Archive' });
    await expect(archive).not.toBeInViewport();
    await swipe(shipped, -110);
    // Whole once it has come to rest there.
    await expect(archive).toBeInViewport({ ratio: 1 });

    // A finger on the middle of the row, where its text has slid to.
    const box = await boxOf(shipped);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(archive).not.toBeInViewport();
    await expect(reader(page)).toHaveCount(0);
    await path(page).toBe('/inbox');

    await swipe(shipped, -110);
    await expect(archive).toBeInViewport({ ratio: 1 });
    const pressed = await boxOf(archive);
    await page.touchscreen.tap(pressed.x + pressed.width / 2, pressed.y + pressed.height / 2);
    await expect(toast(page, 'Your order has shipped')).toBeVisible();
    await expect(shipped).toHaveCount(0);
  });

  test('a row swiped right to the edge is read, and then swipes to be unread again', async ({ page, sift }) => {
    await page.goto('/inbox');
    const id = await idOf(page, 'Lunch on Thursday?');
    const lunch = row(page, 'Lunch on Thursday?');
    await expect(lunch.getByRole('button', { name: 'Read' })).toHaveCount(1);
    await swipe(lunch, 380);
    await expect.poll(() => sift.google().mailbox('me@example.org').message(id)!.labelIds).not.toContain('UNREAD');
    await expect(lunch.getByRole('button', { name: 'Unread' })).toHaveCount(1);
    await expect(lunch).toBeVisible();
  });

  test('a finger held on a row selects it; then a press selects or lets go, and the bar along the bottom archives them', async ({ page }) => {
    await page.goto('/inbox');
    const selected = page.getByText('1 selected').filter({ visible: true });
    await hold(row(page, 'Your order has shipped'), selected);
    await expect(reader(page)).toHaveCount(0);

    await row(page, 'Lunch on Thursday?').tap();
    await expect(page.getByText('2 selected').filter({ visible: true })).toBeVisible();
    await expect(reader(page)).toHaveCount(0);
    await row(page, 'Lunch on Thursday?').tap();
    await expect(selected).toBeVisible();
    await row(page, 'Lunch on Thursday?').tap();

    await page.getByRole('button', { name: 'Archive', exact: true }).filter({ visible: true }).last().tap();
    await expect(toast(page, '2 conversations')).toBeVisible();
    await expect(row(page, 'Your order has shipped')).toHaveCount(0);
    await expect(row(page, 'Lunch on Thursday?')).toHaveCount(0);
    await expect(page.getByText(/selected$/).filter({ visible: true })).toHaveCount(0);

    // A press on a row opens it again.
    await row(page, 'Notes from the review').tap();
    await expect(reader(page)).toBeVisible();
  });

  test('Select none lets go of every row, and nothing selected on a phone keeps its bar', async ({ page }) => {
    await page.goto('/inbox');
    const selected = page.getByText('1 selected').filter({ visible: true });
    await hold(row(page, 'Your order has shipped'), selected);
    await page.getByRole('button', { name: 'Select none' }).filter({ visible: true }).tap();
    await expect(selected).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search mail' }).filter({ visible: true })).toBeVisible();
  });
});
