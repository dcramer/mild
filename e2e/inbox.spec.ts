import { PHONE, expect, inboxLink, inboxRow, inboxRows, param, path, reader, settings, settingsInbox, test, toast } from './sift.ts';

test.describe('Inbox, off', () => {
  test('is turned on in Settings, after saying what it keeps, and then is a section listing the inbox', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Inbox is off' })).toBeVisible();
    await expect(inboxLink(page)).toHaveCount(0);

    await page.goto('/?settings=1');
    await settingsInbox(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    await settingsInbox(page)
      .getByRole('group', { name: 'Keep a copy of all your inbox mail in Sift?' })
      .getByRole('button', { name: 'Turn on', exact: true })
      .click();
    await expect(settingsInbox(page).getByRole('button', { name: 'Turn off', exact: true })).toBeVisible();
    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(settings(page)).toHaveCount(0);

    await inboxLink(page).click();
    await path(page).toBe('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
  });
});

test.describe('Inbox', () => {
  test.use({ variant: 'inbox' });

  test('lists conversations newest first, with what Sift thinks of each, and narrows by it', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await expect(inboxRows(page).first()).toContainText('This week in widgets');
    await expect(inboxRows(page).first()).toContainText('Newsletters');
    await expect(inboxRow(page, 'Your March bill')).toContainText('Utility3');

    await page.getByRole('radio', { name: 'Sorted' }).click();
    await param(page, 'view').toBe('sorted');
    await expect(inboxRows(page)).toHaveCount(10);
    await expect(inboxRow(page, 'This week in widgets')).toBeVisible();
    await page.getByRole('radio', { name: 'Needs you' }).click();
    await expect(inboxRows(page)).toHaveCount(9);
    await expect(inboxRow(page, 'This week in widgets')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search senders and subjects' }).fill('utility');
    await expect(inboxRows(page)).toHaveCount(1);
  });

  test('J and K move, O opens a conversation folded to all but its newest, and opening it marks it read', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await expect(inboxRows(page).first()).toBeFocused();
    await page.keyboard.press('o');
    await expect(reader(page).getByRole('heading', { name: 'This week in widgets', level: 2 })).toBeVisible();
    await expect(reader(page).getByText('Five stories about widgets.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reader(page)).toHaveCount(0);

    await inboxRow(page, 'Your March bill').getByRole('cell').nth(2).click();
    const open = reader(page);
    await expect(open.getByRole('heading', { name: 'Your March bill', level: 2 })).toBeVisible();
    const folded = open.getByRole('cell', { name: /^Utility/ });
    await expect(folded).toHaveCount(2);
    await expect(open.getByText('Your bill is ready.', { exact: true }).last()).toBeVisible();
    await folded.first().click();
    await expect(folded).toHaveCount(2);
    await expect(open.getByRole('link', { name: 'Utility' }).nth(1)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);

    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('checkbox', { name: 'Unread' }).check();
    await param(page, 'unread').toBe('1');
    await expect(inboxRows(page)).toHaveCount(17);
    await expect(inboxRow(page, 'Your March bill')).toHaveCount(0);
  });

  test('X selects, E archives what is selected, and Undo puts it back', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    const bar = page.getByRole('toolbar', { name: 'Selected rows' });
    await expect(bar).toContainText('2 selected');
    await page.keyboard.press('e');
    await expect(toast(page, '2 conversations')).toBeVisible();
    await expect(inboxRows(page)).toHaveCount(17);
    await expect(inboxRow(page, 'This week in widgets')).toHaveCount(0);
    await expect(bar).toHaveCount(0);

    await page.keyboard.press('z');
    await expect(inboxRows(page)).toHaveCount(19);
    await expect(inboxRow(page, 'This week in widgets')).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE });

    test('reads as a mail app, and archiving from the reader goes on to the next conversation', async ({ page }) => {
      await page.goto('/inbox');
      const widgets = page.getByRole('row').filter({ hasText: 'Widgets, part two' });
      await expect(widgets).toContainText('Weekly Digest');
      await expect(widgets).toContainText('Newsletters');
      await widgets.click();
      const open = reader(page);
      await expect(open.getByRole('heading', { name: 'Widgets, part two', level: 2 })).toBeVisible();
      await open.getByRole('button', { name: 'Archive', exact: true }).click();
      await expect(open.getByRole('heading', { name: 'Your order has shipped', level: 2 })).toBeVisible();
      await expect(toast(page, 'Widgets, part two')).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).click();
      await expect(page.getByRole('row').filter({ hasText: 'Widgets, part two' })).toHaveCount(0);
    });
  });
});
