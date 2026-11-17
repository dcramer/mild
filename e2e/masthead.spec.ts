import { expect, PHONE, pointAt, settings, sideScroll, test, tooltip } from './sift.ts';

test.describe("The masthead's line", () => {
  test('says how long since Sift synced and what the model cost over 30 days, and the cost previews each window', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('banner');
    const cost = banner.getByRole('link', { name: /30D$/ }).filter({ visible: true });
    await expect(cost).toHaveText('$0 30D');
    // Read out as "Synced just now"; each mailbox's own time when pointed at. Pointed at once the cost has
    // arrived, which moves it left.
    const synced = banner.getByText(/^Synced(just now|\d+ min ago)$/).filter({ visible: true });
    await pointAt(synced);
    await expect(tooltip(page)).toHaveText(/^me@example\.org: /);
    await expect(cost).toHaveAttribute('href', '/activity');
    await expect(page.getByText(/without a model/)).toHaveCount(0);

    await pointAt(cost);
    for (const window of ['24H', '7D', '30D']) await expect(page.getByRole('term').filter({ hasText: window })).toBeVisible();
    await expect(page.getByText('Today', { exact: true })).toBeVisible();
  });

  test('on a phone, the bar is the name, the line and the menu, and the menu shows the costs above the account', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: /30D$/ }).filter({ visible: true })).toBeVisible();
    // The page's title says where you are, right under the bar.
    await expect(banner.getByText('For review').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await sideScroll(page).toBe(0);

    await page.getByRole('button', { name: 'Menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    for (const window of ['24H', '7D', '30D']) await expect(menu.getByRole('term').filter({ hasText: window })).toBeVisible();
    await expect(menu.getByText('me@example.org')).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await menu.getByRole('button', { name: 'Settings' }).click();
    await expect(settings(page)).toBeVisible();
  });
});
