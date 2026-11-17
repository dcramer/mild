import type { Page } from '@playwright/test';
import { choose, expect, panel, row, test } from './sift.ts';

/** For review's rows: the header row has no answer. */
const rows = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('combobox', { name: 'What this message is' }) });
const param = (page: Page, name: string) => new URL(page.url()).searchParams.get(name);
const heading = (page: Page, subject: string) => panel(page).getByRole('heading', { name: subject, level: 2 });

test.describe('For review, narrowed', () => {
  test('search matches senders’ names, addresses and subjects', async ({ page }) => {
    await page.goto('/');
    await expect(rows(page)).toHaveCount(9);
    const search = page.getByRole('searchbox', { name: 'Search senders and subjects' });

    await search.fill('Ada');
    await expect(rows(page)).toHaveCount(2);
    expect(param(page, 'q')).toBe('Ada');
    await search.fill('db-');
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, 'Replica lag on db-3')).toBeVisible();
    await search.fill('promo.example.com');
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, '48 hours only: 30% off')).toBeVisible();
    await search.fill('nothing like this');
    await expect(page.getByText('Nothing waiting matches.')).toBeVisible();

    await search.fill('');
    await expect(rows(page)).toHaveCount(9);
  });

  test('filters narrow the list, and each one on can be cleared', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Filters' }).click();
    const filters = page.getByRole('complementary', { name: 'Filters' });
    await filters.getByRole('group', { name: 'Label' }).getByRole('radio', { name: 'Unlabelled' }).click();
    await expect(rows(page)).toHaveCount(6);
    await filters.getByRole('group', { name: 'Label' }).getByRole('radio', { name: 'Notifications' }).click();
    await expect(rows(page)).toHaveCount(2);
    await filters.getByRole('group', { name: 'Label' }).getByRole('radio', { name: 'Any' }).click();
    await filters.getByRole('group', { name: 'Then' }).getByRole('radio', { name: 'Archive' }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(row(page, 'Winter sale starts now')).toBeVisible();

    await page.getByRole('button', { name: 'Filters, 1 on' }).click();
    await expect(filters).toHaveCount(0);
    await page.getByRole('list', { name: 'Filters that are on' }).getByRole('button', { name: 'Clear Then: Archive' }).click();
    await expect(rows(page)).toHaveCount(9);
    expect(param(page, 'does')).toBeNull();
  });

  test('a narrowed list stays narrowed through a reload', async ({ page }) => {
    await page.goto('/?q=Ada');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole('searchbox', { name: 'Search senders and subjects' })).toHaveValue('Ada');
  });
});

test.describe('Working through For review', () => {
  test('J and K move through the rows, Enter opens one, / goes to the search', async ({ page }) => {
    await page.goto('/');
    await expect(rows(page)).toHaveCount(9);
    await page.keyboard.press('j');
    await expect(row(page, 'Replica lag on db-3')).toBeFocused();
    await page.keyboard.press('j');
    await expect(row(page, 'Disk 91% full on db-2')).toBeFocused();
    await page.keyboard.press('k');
    await expect(row(page, 'Replica lag on db-3')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(heading(page, 'Replica lag on db-3')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);

    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search senders and subjects' })).toBeFocused();
    await page.keyboard.type('Grace');
    await expect(rows(page)).toHaveCount(1);
  });

  test('the panel steps through the list, by its buttons and by J and K', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Replica lag on db-3' }).click();
    const open = panel(page);
    await expect(open.getByText('1 of 12')).toBeVisible();
    await expect(open.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await open.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Disk 91% full on db-2')).toBeVisible();
    await expect(open.getByText('2 of 12')).toBeVisible();
    await page.keyboard.press('j');
    await expect(heading(page, 'Re: Fix the release script (#412)')).toBeVisible();
    await page.keyboard.press('k');
    await expect(heading(page, 'Disk 91% full on db-2')).toBeVisible();
    await open.getByRole('button', { name: 'Previous' }).click();
    await expect(heading(page, 'Replica lag on db-3')).toBeVisible();
    expect(param(page, 'message')).toBe('m10');
  });

  test('Escape after stepping closes the panel and leaves no message in the address', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Replica lag on db-3' }).click();
    const open = panel(page);
    await open.getByRole('button', { name: 'Next' }).click();
    await open.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Re: Fix the release script (#412)')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');
    // The keys are the list's again, and no panel comes back.
    await page.keyboard.press('j');
    await expect(rows(page).and(page.locator(':focus'))).toHaveCount(1);
    await expect(panel(page)).toHaveCount(0);
  });

  test('closing the panel leaves the list on the message it was showing', async ({ page }) => {
    await page.goto('/');
    await expect(rows(page)).toHaveCount(9);
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(heading(page, 'Replica lag on db-3')).toBeVisible();
    await page.keyboard.press('j');
    await expect(heading(page, 'Disk 91% full on db-2')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(row(page, 'Disk 91% full on db-2')).toBeFocused();
    await page.keyboard.press('j');
    await expect(row(page, 'Re: Fix the release script (#412)')).toBeFocused();
    await page.keyboard.press('k');
    await page.keyboard.press('Enter');
    await expect(heading(page, 'Disk 91% full on db-2')).toBeVisible();
  });

  test('closing the panel on a folded row’s later message leaves the list on that row', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Bump zod from 4.0.0 to 4.0.2' }).click();
    await panel(page).getByRole('button', { name: 'Previous' }).click();
    await expect(heading(page, 'Run failed: CI on main')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(row(page, 'Run failed: Deploy on main')).toBeFocused();
  });

  test('a row pressed while the panel is still sliding away opens', async ({ page }) => {
    await page.goto('/');
    const disk = (await page.getByRole('cell', { name: 'Disk 91% full on db-2' }).boundingBox())!;
    await page.getByRole('cell', { name: 'Replica lag on db-3' }).click();
    await expect(heading(page, 'Replica lag on db-3')).toBeVisible();
    await page.keyboard.press('Escape');
    // At once, where the row is: a locator's click would wait for the panel to be gone.
    await page.mouse.click(disk.x + 10, disk.y + disk.height / 2);
    await expect(heading(page, 'Disk 91% full on db-2')).toBeVisible();
    // Closing it goes back to the list, not to the message closed before.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');
  });

  test('the panel steps through a folded row’s messages together, as the list shows them', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Run failed: Deploy on main' }).click();
    const open = panel(page);
    await expect(heading(page, 'Run failed: Deploy on main')).toBeVisible();
    await open.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Run failed: CI on main')).toBeVisible();
    await open.getByRole('button', { name: 'Next' }).click();
    await expect(heading(page, 'Bump zod from 4.0.0 to 4.0.2')).toBeVisible();
  });

  test('closing the panel keeps the search, and nothing else, in the address', async ({ page }) => {
    await page.goto('/?q=Ada');
    await page.getByRole('cell', { name: 'Lunch on Thursday?' }).click();
    await expect(panel(page).getByText('2 of 2')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('?q=Ada');

    await page.goto('/?q=Ada&message=m6&account=me%40example.org');
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('?q=Ada');
    await expect(rows(page)).toHaveCount(2);
  });

  test('the close button closes the panel, and Back does not bring it back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    const open = panel(page);
    await expect(heading(page, 'Notes from the review')).toBeVisible();
    await open.getByRole('button', { name: 'Close' }).click();
    await expect(open).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');

    await page.goBack();
    await expect(panel(page)).toHaveCount(0);
    expect(param(page, 'message')).toBeNull();
  });

  test('Back closes the panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    await expect(heading(page, 'Notes from the review')).toBeVisible();
    await page.goBack();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(row(page, 'Notes from the review')).toBeVisible();
  });

  test('Escape in the panel’s dropdown closes only the dropdown', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    const open = panel(page);
    await open.getByRole('combobox', { name: 'What this message is' }).click();
    await expect(page.getByRole('option', { name: 'Marketing', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(heading(page, 'Notes from the review')).toBeVisible();
  });

  test('the panel’s add-label dialog closes back to the panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    const open = panel(page);
    await choose(open, 'Add a label…');
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(heading(page, 'Notes from the review')).toBeVisible();
    expect(param(page, 'message')).toBe('m7');
  });
});
