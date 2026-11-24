import { TOUCH, boxOf, dismiss, edgeSwipe, expect, fingerOver, hold, path, reader, swipe, test, toast, ME, phoneMenu, sections } from './sift.ts';
import type { Page } from '@playwright/test';
import { ruleDialog } from './rule.ts';

/** A conversation's row in Inbox on a phone, where it has no check to find it by. */
const rowAbout = (page: Page, subject: string) => page.getByRole('row').filter({ hasText: subject });
const idOf = async (page: Page, subject: string) => (await rowAbout(page, subject).getAttribute('data-holds'))!.split('/')[1]!;

test.describe('Inbox by touch, on a phone', () => {
  test.use({ variant: 'inbox', ...TOUCH });

  test('a row swiped left to the edge is archived once its toast goes, and Undo before then puts it back', async ({ page, sift }) => {
    await page.goto('/inbox');
    const id = await idOf(page, 'Your order has shipped');
    await swipe(rowAbout(page, 'Your order has shipped'), -380);
    await expect(rowAbout(page, 'Your order has shipped')).toHaveCount(0);
    // Flush on the tab bar, part of the foot of the screen; Compose is in the bar, so nothing floats or moves for it.
    const note = await boxOf(toast(page, 'Your order has shipped'));
    const tabs = await boxOf(sections(page));
    expect(Math.abs(tabs.y - (note.y + note.height))).toBeLessThanOrEqual(1);
    await expect(sections(page).getByRole('button', { name: 'Compose' })).toBeVisible();
    await toast(page, 'Your order has shipped').getByRole('button', { name: /^Undo/ }).tap();
    await expect(rowAbout(page, 'Your order has shipped')).toBeVisible();
    expect(sift.google().mailbox(ME).labelsOf(id)).toContain('INBOX');

    await swipe(rowAbout(page, 'Your order has shipped'), -380);
    await dismiss(page, 'Your order has shipped');
    await expect.poll(() => sift.google().mailbox(ME).labelsOf(id)).not.toContain('INBOX');
    await expect(rowAbout(page, 'Your order has shipped')).toHaveCount(0);
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

  test('a row swiped away closes up, its height shrinking to nothing in the press’s colour, rather than vanishing', async ({ page }) => {
    await page.goto('/inbox');
    await expect(rowAbout(page, 'Your order has shipped')).toBeVisible();
    // Every height the row takes on its way out, as the browser lays it out.
    await page.evaluate(`(() => {
      const tr = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Your order has shipped'));
      window.heights = [tr.offsetHeight];
      new ResizeObserver(([entry]) => window.heights.push(entry.borderBoxSize[0].blockSize)).observe(tr);
    })()`);
    await swipe(rowAbout(page, 'Your order has shipped'), -380);
    await expect(rowAbout(page, 'Your order has shipped')).toHaveCount(0);
    const heights = await page.evaluate<number[]>('window.heights');
    const full = heights[0]!;
    expect(heights.some((h) => h > 1 && h < full / 2)).toBe(true);
    expect(Math.min(...heights)).toBeLessThan(2);
    await dismiss(page, 'Your order has shipped');
  });

  test('a finger drawn in from the left edge opens the menu, as the menu button does', async ({ page }) => {
    await page.goto('/inbox');
    const shipped = await boxOf(rowAbout(page, 'Your order has shipped'));
    await edgeSwipe(page, shipped.y + shipped.height / 2);
    const menu = phoneMenu(page);
    await expect(sections(menu)).toBeVisible();
    await menu.getByRole('button', { name: 'Close menu' }).tap();
    await expect(menu).toHaveCount(0);
    // The row the finger crossed did not slide.
    await expect(rowAbout(page, 'Your order has shipped').getByRole('button', { name: 'Read' })).not.toBeInViewport();
  });

  test('a short swipe stops with its press showing; a press on the row then closes it and opens nothing, and the press archives', async ({ page }) => {
    await page.goto('/inbox');
    const shipped = rowAbout(page, 'Your order has shipped');
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
    const lunch = rowAbout(page, 'Lunch on Thursday?');
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

    // It ends as every label menu does, and Make a rule… gives way to the rule dialog, started on the sender.
    await swipe(lunch, 380);
    await expect(sheet.getByRole('listitem').nth(-2)).toHaveText('Add a label…');
    await expect(sheet.getByRole('listitem').last()).toHaveText('Make a rule…');
    await sheet.getByRole('button', { name: 'Make a rule…' }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(ruleDialog(page)).toContainText('ada@example.org');
    await page.keyboard.press('Escape');
    await expect(ruleDialog(page)).toHaveCount(0);

    await swipe(lunch, 380);
    await sheet.getByRole('button', { name: /^Receipts/ }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(lunch).toHaveCount(0);
    await expect(toast(page, 'Lunch on Thursday?')).toContainText('Receipts');
    await dismiss(page, 'Lunch on Thursday?');
    await expect.poll(() => sift.google().mailbox(ME).labelsOf(id)).not.toContain('INBOX');
  });

  test('a finger held on a row selects it; then a press selects or lets go, and the bar along the bottom archives them', async ({ page }) => {
    await page.goto('/inbox');
    const selected = page.getByText('1 selected').filter({ visible: true });
    await hold(rowAbout(page, 'Your order has shipped'), selected);
    await expect(reader(page)).toHaveCount(0);

    await rowAbout(page, 'Lunch on Thursday?').tap();
    await expect(page.getByText('2 selected').filter({ visible: true })).toBeVisible();
    await expect(reader(page)).toHaveCount(0);
    await rowAbout(page, 'Lunch on Thursday?').tap();
    await expect(selected).toBeVisible();
    await rowAbout(page, 'Lunch on Thursday?').tap();

    await page.getByRole('button', { name: 'Archive', exact: true }).filter({ visible: true }).last().tap();
    await expect(toast(page, '2 conversations')).toBeVisible();
    await expect(rowAbout(page, 'Your order has shipped')).toHaveCount(0);
    await expect(rowAbout(page, 'Lunch on Thursday?')).toHaveCount(0);
    await expect(page.getByText(/selected$/).filter({ visible: true })).toHaveCount(0);

    // A press on a row opens it again.
    await rowAbout(page, 'Notes from the review').tap();
    await expect(reader(page)).toBeVisible();
  });

  test('a finger left on a row while the list scrolls under it selects nothing; one held still selects', async ({ page }) => {
    await page.goto('/inbox');
    const selected = page.getByText('1 selected').filter({ visible: true });
    const [shipped, lunch] = [await fingerOver(rowAbout(page, 'Your order has shipped')), await fingerOver(rowAbout(page, 'Lunch on Thursday?'))];
    await page.clock.install();

    await lunch.down();
    await page.clock.runFor(600);
    await lunch.lift();
    await expect(selected).toBeVisible();
    await page.getByRole('button', { name: 'Select none' }).filter({ visible: true }).tap();
    await expect(selected).toHaveCount(0);

    await shipped.down();
    // The list moves under the finger, as when a scroll begins slowly or the row starts to swipe, and the phone does not say so.
    await page.evaluate("dispatchEvent(new Event('scroll'))");
    await page.clock.runFor(600);
    await shipped.lift();
    await expect(selected).toHaveCount(0);
  });

  test('Select none lets go of every row, and nothing selected on a phone keeps its bar', async ({ page }) => {
    await page.goto('/inbox');
    const selected = page.getByText('1 selected').filter({ visible: true });
    await hold(rowAbout(page, 'Your order has shipped'), selected);
    await page.getByRole('button', { name: 'Select none' }).filter({ visible: true }).tap();
    await expect(selected).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search mail' }).filter({ visible: true })).toBeVisible();
  });
});
