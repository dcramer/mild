import { expect, inboxRow, inboxRows, param, reader, test } from './sift.ts';

test.describe('Inbox, with the model', () => {
  test.use({ variant: 'inbox' });

  test('Ask turns words into filters the reader can see and clear, and says what it cannot narrow by', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    const search = page.getByRole('searchbox', { name: 'Search senders and subjects' });

    await search.fill('unanswered');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByText('Sift cannot tell which mail you have answered.')).toBeVisible();
    await search.fill('');
    await expect(inboxRows(page)).toHaveCount(19);

    await search.fill('utility');
    await search.press('Enter');
    await param(page, 'from').toBe('billing@utility.example.net');
    await expect(search).toHaveValue('');
    const chip = page.getByRole('button', { name: 'Clear From: billing@utility.example.net' });
    await expect(chip).toBeVisible();
    await expect(inboxRows(page)).toHaveCount(1);
    await expect(inboxRow(page, 'Your March bill')).toBeVisible();

    await chip.click();
    await param(page, 'from').toBe(null);
    await expect(inboxRows(page)).toHaveCount(19);
  });

  test('Summarize says what a conversation says, once, and its cost is in the history', async ({ page }) => {
    await page.goto('/inbox');
    await inboxRow(page, 'Your March bill').getByRole('cell').nth(2).click();
    const open = reader(page);
    await expect(open.getByRole('heading', { name: 'Your March bill', level: 2 })).toBeVisible();

    await open.getByRole('button', { name: 'Summarize', exact: true }).click();
    const said = open.getByText('3 messages about Your March bill. Nothing is asked of you.');
    await expect(said).toBeVisible();
    await expect(open.getByRole('button', { name: 'Summarize', exact: true })).toHaveCount(0);
    await open.getByText(/^History · \d+$/).click();
    await expect(open.getByText('Summarized', { exact: true })).toBeVisible();
    await expect(open.getByText(/^faux\/stand-in, \d+ tokens, /)).toBeVisible();

    // Opened again, it is the one recorded.
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await inboxRow(page, 'Your March bill').getByRole('cell').nth(2).click();
    await expect(said).toBeVisible();

    // A conversation of one short message has nothing to summarize.
    await page.keyboard.press('Escape');
    await inboxRow(page, 'This week in widgets').getByRole('cell').nth(2).click();
    await expect(open.getByRole('heading', { name: 'This week in widgets', level: 2 })).toBeVisible();
    await expect(open.getByText('Five stories about widgets.')).toBeVisible();
    await expect(open.getByRole('button', { name: 'Summarize', exact: true })).toHaveCount(0);
  });
});
