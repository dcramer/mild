import { addLabelsDialog, boxOf, choose, expect, panel, query, reviewRows, reviewSearch, row, test, writeLabel } from './sift.ts';

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

test.describe('For review, with Sift on', () => {
  // A service worker's page is out of reach of page.route, which holds the list back here.
  test.use({ variant: 'on', serviceWorkers: 'block' });

  test('once seen on, holds no room for "Sift is off" while the list loads, so the list does not move when it arrives', async ({ page }) => {
    await page.goto('/');
    await expect(reviewRows(page).first()).toBeVisible();
    const loaded = await boxOf(reviewSearch(page));

    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    await page.route(
      (url) => url.pathname === '/api/suggestions',
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await page.reload();
    await expect(page.getByLabel('Loading').first()).toBeVisible();
    expect((await boxOf(reviewSearch(page))).y).toBe(loaded.y);
    release();
    await expect(reviewRows(page).first()).toBeVisible();
    expect((await boxOf(reviewSearch(page))).y).toBe(loaded.y);
  });
});
