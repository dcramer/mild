import type { Locator } from '@playwright/test';
import { PHONE, boxOf, expect, test } from './sift.ts';

const middle = async (target: Locator) => {
  const box = await boxOf(target);
  return box.y + box.height / 2;
};

test.describe('A list on a desktop', () => {
  test('leaves its name to the rail, and its action ends the search bar', async ({ page }) => {
    await page.goto('/rules');
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeAttached();
    const search = page.getByRole('searchbox', { name: 'Search senders, domains and labels' });
    const add = page.getByRole('button', { name: 'Add a rule' });
    await expect(add).toHaveCount(1);
    // Nothing over the search: it starts level with the rail's name.
    const name = await boxOf(page.getByRole('link', { name: 'Mild', exact: true }).first());
    const [bar, press] = [await boxOf(search), await boxOf(add)];
    expect(bar.y).toBeLessThan(name.y + name.height);
    expect(press.x).toBeGreaterThan(bar.x + bar.width);
    expect(Math.abs((await middle(add)) - (await middle(search)))).toBeLessThan(4);
  });

  test('with something before its rows still starts with its search, its action ending the bar, and that under it', async ({ page }) => {
    await page.goto('/activity');
    const period = page.getByRole('combobox', { name: 'Period' });
    await expect(period).toHaveCount(1);
    const search = page.getByRole('searchbox', { name: 'Search subject or sender' });
    const name = await boxOf(page.getByRole('link', { name: 'Mild', exact: true }).first());
    const [bar, press] = [await boxOf(search), await boxOf(period)];
    expect(bar.y).toBeLessThan(name.y + name.height);
    expect(press.x).toBeGreaterThan(bar.x + bar.width);
    expect(Math.abs((await middle(period)) - (await middle(search)))).toBeLessThan(4);
    // The chart the period governs comes under the bar.
    expect((await boxOf(page.getByRole('listitem', { name: /: \d+ / }).first())).y).toBeGreaterThan(bar.y + bar.height);
  });

  test('with no search holds its action on a line over the list', async ({ page }) => {
    await page.goto('/labels');
    const add = page.getByRole('button', { name: 'Add labels' });
    await expect(add).toHaveCount(1);
    const first = page.getByRole('row').first();
    expect((await boxOf(add)).y).toBeLessThan((await boxOf(first)).y);
  });
});

test.describe('A list on a phone', () => {
  test.use({ viewport: PHONE });

  test('is named by the tab bar, and its action floats just above it at the right', async ({ page }) => {
    await page.goto('/rules');
    const tabs = page.getByRole('navigation', { name: 'Sections' });
    await expect(tabs.getByRole('link', { name: 'Rules' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeAttached();
    const add = page.getByRole('button', { name: 'Add a rule' });
    await expect(add).toHaveCount(1);
    const [press, foot] = [await boxOf(add), await boxOf(tabs)];
    expect(press.y + press.height).toBeLessThan(foot.y);
    expect(press.x + press.width).toBeGreaterThan(PHONE.width - 24);
    await add.click();
    await expect(page.getByRole('dialog', { name: 'Add a rule' })).toBeVisible();
  });

  test('has its own action over the list, and scrolls to its end clear of the tab bar', async ({ page }) => {
    await page.goto('/labels');
    const last = page.getByRole('row').last();
    await expect(last).toBeAttached();
    expect((await boxOf(page.getByRole('button', { name: 'Add labels' }))).y).toBeLessThan((await boxOf(page.getByRole('row').first())).y);
    await page.evaluate('scrollTo(0, document.documentElement.scrollHeight)');
    const [end, tabs] = [await boxOf(last), await boxOf(page.getByRole('navigation', { name: 'Sections' }))];
    expect(end.y + end.height).toBeLessThanOrEqual(tabs.y);
  });
});
