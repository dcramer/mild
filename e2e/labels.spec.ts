import type { Page } from '@playwright/test';
import { choose, expect, panel, param, PHONE, query, refused, row, settled, test } from './sift.ts';

/** The section of the Labels screen for one outcome ("Archived"), with its rows. */
const group = (page: Page, title: string) => page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::section[1]');

/** The label's panel on the Labels screen. Not the toast saying it was removed, a dialog named by the label too, which is never modal. */
const labelPanel = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true }).and(page.locator(':not([aria-modal="false"])'));

/** "12 of 30" beside `Add labels`: how many labels there are. */
async function labelCount(page: Page) {
  const text = await page.getByText(/^\d+ of \d+$/).textContent();
  return Number(text?.split(' ')[0]);
}

async function openLabel(page: Page, name: string) {
  await page.getByText(name, { exact: true }).click();
  const opened = labelPanel(page, name);
  await expect(opened.getByRole('heading', { name, level: 2 })).toBeVisible();
  return opened;
}

test.describe('Labels', () => {
  test('heads its figures once, over the first group, and on a phone not at all', async ({ page }) => {
    await page.goto('/labels');
    // Heads kept for screen readers are in a row a pixel wide; one a phone drops has no width.
    const shown = async (name: string) =>
      Number(
        await page.evaluate(
          `[...document.querySelectorAll('main th')].filter((th) => th.textContent === ${JSON.stringify(name)} && th.getBoundingClientRect().width > 0 && th.closest('thead').getBoundingClientRect().width > 1).length`,
        ),
      );
    await expect(page.getByRole('main').getByRole('columnheader', { name: 'Messages', exact: true })).toHaveCount(3);
    await expect.poll(() => shown('Messages')).toBe(1);
    await expect.poll(() => shown('Right')).toBe(1);
    await page.setViewportSize(PHONE);
    await expect.poll(() => shown('Messages')).toBe(0);
  });

  test('changing what Sift does with a label moves it, and stays changed', async ({ page }) => {
    await page.goto('/labels');
    await expect(group(page, 'Archived').getByText('Newsletters', { exact: true })).toBeVisible();

    const opened = await openLabel(page, 'Newsletters');
    await param(page, 'label').toBe('newsletter');
    await expect(opened.getByRole('textbox', { name: 'Name' })).toHaveValue('Newsletters');
    await expect(opened.getByRole('combobox', { name: 'What Sift does with it' })).toHaveText(/Archive/);
    await expect(opened.getByRole('checkbox', { name: 'Unsubscribe, when the sender offers a safe way' })).not.toBeChecked();
    await expect(opened.getByRole('button', { name: 'Save' })).toBeDisabled();

    await opened.getByRole('combobox', { name: 'What Sift does with it' }).click();
    await expect(page.getByRole('option')).toHaveText([/Keep/, /Archive/, /Spam/, /Block/]);
    await page.getByRole('option', { name: 'Keep' }).click();
    await opened.getByRole('button', { name: 'Save' }).click();

    // Saving leaves the panel open on what was saved.
    await expect(opened.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(opened.getByRole('button', { name: 'Undo changes' })).toHaveCount(0);
    await param(page, 'label').toBe('newsletter');

    await opened.getByRole('button', { name: 'Close' }).click();
    await expect(opened).toHaveCount(0);
    await param(page, 'label').toBeNull();
    await expect(group(page, 'Kept in your inbox').getByText('Newsletters', { exact: true })).toBeVisible();

    await page.reload();
    await expect(group(page, 'Kept in your inbox').getByText('Newsletters', { exact: true })).toBeVisible();
    await expect(labelPanel(page, 'Newsletters')).toHaveCount(0);
  });

  test('Spam has no Mark it read, and Undo changes puts the form back', async ({ page }) => {
    await page.goto('/labels?label=marketing');
    const opened = labelPanel(page, 'Marketing');
    const markRead = opened.getByRole('checkbox', { name: 'Mark it read' });
    await markRead.check();
    await expect(opened.getByRole('button', { name: 'Undo changes' })).toBeVisible();

    await opened.getByRole('combobox', { name: 'What Sift does with it' }).click();
    await page.getByRole('option', { name: 'Spam' }).click();
    await expect(markRead).toHaveCount(0);

    await opened.getByRole('button', { name: 'Undo changes' }).click();
    await expect(opened.getByRole('combobox', { name: 'What Sift does with it' })).toHaveText(/Archive/);
    await expect(markRead).not.toBeChecked();

    await opened.getByRole('combobox', { name: 'What Sift does with it' }).click();
    await page.getByRole('option', { name: 'Spam' }).click();
    await opened.getByRole('button', { name: 'Save' }).click();
    await expect(opened.getByRole('button', { name: 'Save' })).toBeDisabled();
    await opened.getByRole('button', { name: 'Close' }).click();
    await expect(group(page, 'Marked spam').getByText('Marketing', { exact: true })).toBeVisible();
  });

  test('a renamed label keeps its place in the list and its panel', async ({ page }) => {
    await page.goto('/labels');
    const opened = await openLabel(page, 'Newsletters');
    await opened.getByRole('textbox', { name: 'Name' }).fill('Digests');
    await opened.getByRole('textbox', { name: 'What it is' }).fill('Weekly roundups I read on Sundays.');
    await opened.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('dialog', { name: 'Digests' })).toBeVisible();
    await param(page, 'label').toBe('newsletter');
    await page.getByRole('dialog', { name: 'Digests' }).getByRole('button', { name: 'Close' }).click();
    const listed = group(page, 'Archived').getByRole('row', { name: /^Digests / });
    await expect(listed).toContainText('Weekly roundups I read on Sundays.');
    await expect(group(page, 'Archived').getByText('Newsletters', { exact: true })).toHaveCount(0);
  });

  test('a label cannot be saved without a name', async ({ page }) => {
    await page.goto('/labels?label=newsletter');
    const opened = labelPanel(page, 'Newsletters');
    await opened.getByRole('textbox', { name: 'Name' }).fill('  ');
    await expect(opened.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('suggested labels: one kept, with a note for what the labels already cover', async ({ page }) => {
    await page.goto('/labels');
    await expect(group(page, 'Archived')).toBeVisible();
    const before = await labelCount(page);

    await page.getByRole('button', { name: 'Add labels' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await dialog.getByRole('textbox', { name: 'What mail, and what should happen to it?' }).fill('Archive sales pitches and my receipts');
    await dialog.getByRole('button', { name: 'Suggest labels' }).click();

    await expect(dialog.getByText('Not in these labels')).toBeVisible();
    await expect(dialog.getByText('Your Receipts and transactions label covers receipts already.')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Use Sales pitches' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Add this label' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(group(page, 'Archived').getByText('Sales pitches', { exact: true })).toBeVisible();
    // Made in both mailboxes, so no "Only in".
    await expect(group(page, 'Archived').getByRole('row').filter({ hasText: 'Sales pitches' })).not.toContainText('Only in');
    await expect.poll(() => labelCount(page)).toBe(before + 1);
  });

  test('a suggestion left unticked is not added', async ({ page }) => {
    await page.goto('/labels');
    await page.getByRole('button', { name: 'Add labels' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await dialog.getByRole('textbox', { name: 'What mail, and what should happen to it?' }).fill('No more sales pitches');
    await dialog.getByRole('button', { name: 'Suggest labels' }).click();
    await dialog.getByRole('checkbox', { name: 'Use Sales pitches' }).uncheck();
    await expect(dialog.getByRole('button', { name: 'Add these labels' })).toBeDisabled();
  });

  test('words the labels already cover get the note alone, and Back keeps the words', async ({ page }) => {
    await page.goto('/labels');
    await page.getByRole('button', { name: 'Add labels' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    const words = dialog.getByRole('textbox', { name: 'What mail, and what should happen to it?' });
    await words.fill('Keep my receipts');
    await dialog.getByRole('button', { name: 'Suggest labels' }).click();

    await expect(dialog.getByText('Your Receipts and transactions label covers receipts already.')).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^(Add|Save)/ })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(words).toHaveValue('Keep my receipts');
  });

  refused('words the model makes nothing of say so, and the dialog stays', async ({ page }) => {
    await page.goto('/labels');
    await page.getByRole('button', { name: 'Add labels' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await dialog.getByRole('textbox', { name: 'What mail, and what should happen to it?' }).fill('Something about the weather');
    await dialog.getByRole('button', { name: 'Suggest labels' }).click();
    await expect(dialog.getByText('The model could not suggest labels (the model did not suggest any usable labels). Try again.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Suggest labels' })).toBeEnabled();
  });

  test('a label written by hand', async ({ page }) => {
    await page.goto('/labels');
    await expect(group(page, 'Archived')).toBeVisible();
    const before = await labelCount(page);
    await page.getByRole('button', { name: 'Add labels' }).click();
    await page.getByRole('dialog', { name: 'Add labels' }).getByRole('button', { name: 'Write one yourself' }).click();

    const manual = page.getByRole('dialog', { name: 'Add a label' });
    const add = manual.getByRole('button', { name: 'Add label', exact: true });
    await expect(add).toBeDisabled();
    await manual.getByRole('textbox', { name: 'Name' }).fill('Field trips');
    await manual.getByRole('textbox', { name: 'What it is' }).fill('Permission slips and trip plans from school.');
    await manual.getByRole('combobox', { name: 'What Sift does with it' }).click();
    await page.getByRole('option', { name: 'Keep' }).click();
    await add.click();

    await expect(manual).toHaveCount(0);
    await expect(group(page, 'Kept in your inbox').getByRole('row').filter({ hasText: 'Field trips' })).toContainText(
      'Permission slips and trip plans from school.',
    );
    await expect.poll(() => labelCount(page)).toBe(before + 1);
    await query(page).toBe('');
  });

  test('closing Add labels adds nothing and opens no panel', async ({ page }) => {
    await page.goto('/labels');
    await page.getByRole('button', { name: 'Add labels' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await query(page).toBe('');
  });

  test('removing a label asks in place, then closes its panel with a toast', async ({ page }) => {
    await page.goto('/labels');
    await expect(group(page, 'Archived')).toBeVisible();
    const before = await labelCount(page);
    const opened = await openLabel(page, 'Newsletters');

    await opened.getByRole('button', { name: 'Remove', exact: true }).click();
    const ask = opened.getByRole('group', { name: 'Remove Newsletters and its 1 rule?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toHaveCount(0);
    await settled(page);
    await expect(opened).toBeVisible();

    await opened.getByRole('button', { name: 'Remove', exact: true }).click();
    await ask.getByRole('button', { name: 'Remove', exact: true }).click();

    await expect(opened).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('dialog', { name: 'Newsletters', exact: true })).toContainText('Label removed');
    await param(page, 'label').toBeNull();
    await expect(page.getByRole('main').getByText('Newsletters', { exact: true })).toHaveCount(0);
    await expect.poll(() => labelCount(page)).toBe(before - 1);

    await page.goto('/rules');
    await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'news.example.com' })).toHaveCount(0);
  });

  test('Escape puts back the question to remove, and leaves the panel open', async ({ page }) => {
    await page.goto('/labels?label=newsletter');
    const opened = labelPanel(page, 'Newsletters');
    await opened.getByRole('button', { name: 'Remove', exact: true }).click();
    const ask = opened.getByRole('group', { name: 'Remove Newsletters and its 1 rule?' });
    await expect(ask.getByRole('button', { name: 'Remove', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await settled(page);
    await expect(ask).toHaveCount(0);
    await expect(opened.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await param(page, 'label').toBe('newsletter');
  });

  test('Escape in the outcome list closes only the list', async ({ page }) => {
    await page.goto('/labels?label=newsletter');
    const opened = labelPanel(page, 'Newsletters');
    await opened.getByRole('combobox', { name: 'What Sift does with it' }).click();
    await expect(page.getByRole('option', { name: 'Keep' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('option')).toHaveCount(0);
    await settled(page);
    await expect(opened).toBeVisible();
    await param(page, 'label').toBe('newsletter');
  });

  test('a label’s rule count leads to those rules alone', async ({ page }) => {
    await page.goto('/labels?label=newsletter');
    await labelPanel(page, 'Newsletters').getByRole('link', { name: '1', exact: true }).click();
    await expect(page).toHaveURL(/\/rules\?label=newsletter$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'anyone at news.example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'anyone at ci.example.org' })).toHaveCount(0);
  });

  test('Leave in inbox is Sift’s own: nothing in it to change or remove', async ({ page }) => {
    await page.goto('/labels');
    const opened = await openLabel(page, 'Leave in inbox');
    await expect(opened.getByText('Mail none of your labels fit stays in your inbox.')).toBeVisible();
    await expect(opened.getByRole('textbox')).toHaveCount(0);
    await expect(opened.getByRole('combobox')).toHaveCount(0);
    await expect(opened.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });

  test('Previous and Next step through the labels in the order they are listed', async ({ page }) => {
    await page.goto('/labels');
    const first = await openLabel(page, 'Leave in inbox');
    await expect(first.getByText('1 of 11')).toBeVisible();
    await expect(first.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await first.getByRole('button', { name: 'Next' }).click();
    const second = labelPanel(page, 'Account alerts');
    await expect(second.getByRole('heading', { name: 'Account alerts', level: 2 })).toBeVisible();
    await param(page, 'label').toBe('security');
    await second.getByRole('button', { name: 'Previous' }).click();
    await expect(labelPanel(page, 'Leave in inbox')).toBeVisible();
  });
});

test.describe('Adding a label from an open message', () => {
  const open = async (page: Page) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Lunch on Thursday?' }).click();
    await expect(panel(page)).toBeVisible();
    return page.url();
  };

  test('the new label is a choice in the same panel, on the same message', async ({ page }) => {
    const at = await open(page);
    await choose(panel(page), 'Add a label…');
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Write one yourself' }).click();
    const manual = page.getByRole('dialog', { name: 'Add a label' });
    await manual.getByRole('textbox', { name: 'Name' }).fill('Field trips');
    await manual.getByRole('button', { name: 'Add label', exact: true }).click();

    await expect(manual).toHaveCount(0);
    await settled(page);
    await expect(panel(page)).toBeVisible();
    await expect(page).toHaveURL(at);
    await choose(panel(page), 'Field trips');
    await expect(panel(page).getByRole('combobox', { name: 'What this message is' })).toHaveText(/Field trips/);
  });

  test('a suggested label is a choice in the same panel', async ({ page }) => {
    const at = await open(page);
    await choose(panel(page), 'Add a label…');
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await dialog.getByRole('textbox', { name: 'What mail, and what should happen to it?' }).fill('No more sales pitches');
    await dialog.getByRole('button', { name: 'Suggest labels' }).click();
    await dialog.getByRole('button', { name: 'Add this label' }).click();

    await expect(dialog).toHaveCount(0);
    await settled(page);
    await expect(page).toHaveURL(at);
    await panel(page).getByRole('combobox', { name: 'What this message is' }).click();
    await expect(page.getByRole('option', { name: 'Sales pitches', exact: true })).toBeVisible();
  });

  test('closing the dialog leaves the panel as it was', async ({ page }) => {
    const at = await open(page);
    await choose(panel(page), 'Add a label…');
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await settled(page);
    await expect(panel(page)).toBeVisible();
    await expect(page).toHaveURL(at);
  });

  test('Escape closes only the dialog', async ({ page }) => {
    const at = await open(page);
    await choose(panel(page), 'Add a label…');
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await expect(dialog.getByRole('textbox', { name: 'What mail, and what should happen to it?' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await settled(page);
    await expect(panel(page)).toBeVisible();
    await expect(page).toHaveURL(at);
  });

  test('closing the panel after adding a label keeps it closed', async ({ page }) => {
    await open(page);
    await choose(panel(page), 'Add a label…');
    await page.getByRole('dialog', { name: 'Add labels' }).getByRole('button', { name: 'Write one yourself' }).click();
    const manual = page.getByRole('dialog', { name: 'Add a label' });
    await manual.getByRole('textbox', { name: 'Name' }).fill('Field trips');
    await manual.getByRole('button', { name: 'Add label', exact: true }).click();
    await expect(manual).toHaveCount(0);

    await panel(page).getByRole('button', { name: 'Close' }).first().click();
    await expect(panel(page)).toHaveCount(0);
    await query(page).toBe('');
    await settled(page);
    await expect(row(page, 'Lunch on Thursday?')).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });
});

refused.describe('A mailbox with one label', () => {
  refused.use({ variant: 'bare' });

  refused('removing it is refused, and says why', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'What do you want from Sift?' }).fill('No more sales pitches');
    await page.getByRole('button', { name: 'Suggest labels' }).click();
    await page.getByRole('button', { name: 'Use this label' }).click();
    await page.getByRole('button', { name: 'New mail only' }).click();
    await page.goto('/labels');
    await page.getByText('Sales pitches', { exact: true }).click();
    const opened = page.getByRole('dialog', { name: 'Sales pitches', exact: true });
    await opened.getByRole('button', { name: 'Remove', exact: true }).click();
    await opened.getByRole('group', { name: 'Remove Sales pitches?' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(opened.getByText('Sales pitches is the last of your labels, and Sift reads no mail without one. Add another first.')).toBeVisible();
    await expect(page.getByText('Label removed')).toHaveCount(0);
  });
});
