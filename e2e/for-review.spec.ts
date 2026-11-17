import { addLabelsDialog, choose, expect, panel, query, row, test, writeLabel } from './sift.ts';

test.describe('For review', () => {
  test('adding a label from a row opens only the dialog, and leaves the page as it was', async ({ page }) => {
    await page.goto('/');
    await choose(row(page, 'Notes from the review'), 'Add a label…');
    await expect(addLabelsDialog(page)).toBeVisible();
    await expect(panel(page)).toHaveCount(0);

    await writeLabel(page, 'Field trips');
    await expect(panel(page)).toHaveCount(0);
    await query(page).toBe('');

    // The new label is a choice at once.
    await choose(row(page, 'Notes from the review'), 'Field trips');
    await expect(row(page, 'Notes from the review').getByRole('button', { name: 'Save: Field trips' })).toBeVisible();
  });

  test('closing the add-label dialog leaves the page as it was', async ({ page }) => {
    await page.goto('/');
    await choose(row(page, 'Notes from the review'), 'Add a label…');
    const dialog = addLabelsDialog(page);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    await query(page).toBe('');
  });
});
