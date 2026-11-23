import { TOUCH, boxOf, dismiss, edgeSwipe, expect, hold, path, reader, swipe, test, toast } from './sift.ts';
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
    // Just above the tab bar, as a mail app's, and Compose rises over it rather than lifting it up the screen.
    const note = await boxOf(toast(page, 'Your order has shipped'));
    const tabs = await boxOf(page.getByRole('navigation', { name: 'Sections' }));
    expect(tabs.y - (note.y + note.height)).toBeGreaterThan(0);
    expect(tabs.y - (note.y + note.height)).toBeLessThanOrEqual(17);
    const compose = await boxOf(page.getByRole('button', { name: 'Compose' }));
    expect(compose.y + compose.height).toBeLessThanOrEqual(note.y);
    await toast(page, 'Your order has shipped').getByRole('button', { name: /^Undo/ }).tap();
    await expect(row(page, 'Your order has shipped')).toBeVisible();
    expect(sift.google().mailbox('me@example.org').message(id)!.labelIds).toContain('INBOX');

    await swipe(row(page, 'Your order has shipped'), -380);
    await dismiss(page, 'Your order has shipped');
    await expect.poll(() => sift.google().mailbox('me@example.org').message(id)!.labelIds).not.toContain('INBOX');
    await expect(row(page, 'Your order has shipped')).toHaveCount(0);
  });

  test('the top edge is the page’s own colour, solid and fixed, so iOS extends it rather than blurring the search bar', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByRole('row').first()).toBeVisible();
    const cover = page.locator('.status-cover');
    const box = await boxOf(cover);
    expect(box).toMatchObject({ x: 0, y: 0, width: 390 });
    expect(box.height).toBeGreaterThan(10);
    await expect(cover).toHaveCSS('position', 'fixed');
    await expect(cover).toHaveCSS('background-color', 'rgb(17, 17, 16)');
    // What a touch at the edge hits, as iOS asks, at rest and scrolled.
    expect(await page.evaluate('document.elementFromPoint(195, 4).className')).toBe('status-cover');
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate('scrollY')).toBeGreaterThan(0);
    expect(await page.evaluate('document.elementFromPoint(195, 4).className')).toBe('status-cover');
  });

  test('a finger drawn in from the left edge opens the menu, as the menu button does', async ({ page }) => {
    await page.goto('/inbox');
    const shipped = await boxOf(row(page, 'Your order has shipped'));
    await edgeSwipe(page, shipped.y + shipped.height / 2);
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await menu.getByRole('button', { name: 'Close menu' }).tap();
    await expect(menu).toHaveCount(0);
    // The row the finger crossed did not slide.
    await expect(row(page, 'Your order has shipped').getByRole('button', { name: 'Read' })).not.toBeInViewport();
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

  test('a row swiped right shows Label, which opens a sheet of every label: Cancel keeps it, and a label that archives takes it once its toast goes', async ({
    page,
    sift,
  }) => {
    await page.goto('/inbox');
    const id = await idOf(page, 'Lunch on Thursday?');
    const lunch = row(page, 'Lunch on Thursday?');
    const label = lunch.getByRole('button', { name: 'Label' });
    await swipe(lunch, 110);
    await expect(label).toBeInViewport({ ratio: 1 });
    const pressed = await boxOf(label);
    await page.touchscreen.tap(pressed.x + pressed.width / 2, pressed.y + pressed.height / 2);
    const sheet = page.getByRole('dialog', { name: 'Ada Lovelace' });
    await expect(sheet).toContainText('Lunch on Thursday?');
    await sheet.getByRole('button', { name: 'Cancel' }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(lunch).toBeVisible();

    await swipe(lunch, 380);
    await sheet.getByRole('button', { name: /^Receipts/ }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(lunch).toHaveCount(0);
    await dismiss(page, 'Archive as Receipts');
    await expect.poll(() => sift.google().mailbox('me@example.org').message(id)!.labelIds).not.toContain('INBOX');
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
