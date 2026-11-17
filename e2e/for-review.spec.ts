import { choose, expect, panel, row, test } from './sift.ts';

test.describe('For review', () => {
  test('adding a label from a row opens only the dialog, and leaves the page as it was', async ({ page }) => {
    await page.goto('/');
    await choose(row(page, 'Notes from the review'), 'Add a label…');
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await expect(dialog).toBeVisible();
    await expect(panel(page)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Write one yourself' }).click();
    const manual = page.getByRole('dialog', { name: 'Add a label' });
    await manual.getByRole('textbox', { name: 'Name' }).fill('Field trips');
    await manual.getByRole('button', { name: 'Add label', exact: true }).click();
    await expect(manual).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');

    // The new label is a choice at once.
    await choose(row(page, 'Notes from the review'), 'Field trips');
    await expect(row(page, 'Notes from the review').getByRole('button', { name: 'Save: Field trips' })).toBeVisible();
  });

  test('closing the add-label dialog leaves the page as it was', async ({ page }) => {
    await page.goto('/');
    await choose(row(page, 'Notes from the review'), 'Add a label…');
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });
});
