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

  test('with something before its search holds its action at the top, over that too', async ({ page }) => {
    await page.goto('/activity');
    const period = page.getByRole('combobox', { name: 'Period' });
    await expect(period).toHaveCount(1);
    const search = page.getByRole('searchbox', { name: 'Search subject or sender' });
    const name = await boxOf(page.getByRole('link', { name: 'Mild', exact: true }).first());
    const above = await boxOf(period);
    expect(above.y).toBeLessThan(name.y + name.height);
    expect(above.y + above.height).toBeLessThan((await boxOf(search)).y);
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

  test('names itself under the bar, with its action beside the name', async ({ page }) => {
    await page.goto('/rules');
    const heading = page.getByRole('heading', { name: 'Rules', level: 1 });
    const add = page.getByRole('button', { name: 'Add a rule' });
    await expect(add).toHaveCount(1);
    expect((await boxOf(heading)).height).toBeGreaterThan(20);
    expect(Math.abs((await middle(add)) - (await middle(heading)))).toBeLessThan(4);
  });
});
