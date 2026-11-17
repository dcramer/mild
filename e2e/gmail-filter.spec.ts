import type { Page } from '@playwright/test';
import { addRule, ruleDialog, rulePanel, ruleRows, turnOn } from './rule.ts';
import { expect, row, test } from './sift.ts';

const CI = 'anyone at ci.example.org';

async function openPanel(page: Page, rule: string) {
  await page.goto('/rules');
  await page.getByRole('cell', { name: rule }).click();
  return rulePanel(page, rule);
}

test.describe('A rule as a Gmail filter', () => {
  test("each rule's panel says where it stands in Gmail, and only a filter is marked on the list", async ({ page }) => {
    await page.goto('/rules');
    await expect(ruleRows(page)).toHaveCount(4);
    await expect(ruleRows(page).filter({ hasText: 'In Gmail' })).toHaveCount(1);
    await expect(row(page, CI)).toContainText('In Gmail');

    const ci = await openPanel(page, CI);
    await expect(ci.getByText('Gmail runs this rule as a filter.')).toBeVisible();
    await expect(ci.getByRole('button', { name: 'Remove from Gmail' })).toBeVisible();

    const news = await openPanel(page, 'anyone at news.example.com');
    await expect(news.getByText('Gmail could run this by itself once Sift is on.')).toBeVisible();
    await expect(news.getByRole('listitem').last()).toContainText('Not added to Gmail');
    await expect(news.getByRole('button', { name: 'Add to Gmail…' })).toHaveCount(0);

    const shop = await openPanel(page, 'orders@shop.example.com');
    await expect(shop.getByText('Its filter was deleted in Gmail. Sift will not put it back.')).toBeVisible();
    await expect(shop.getByRole('listitem').last()).toContainText('Deleted in Gmail');
    await expect(shop.getByRole('button', { name: /Gmail/ })).toHaveCount(0);

    const promo = await openPanel(page, 'anyone at promo.example.com');
    await expect(promo.getByText('Gmail filters cannot mark mail as spam.')).toBeVisible();
  });

  test('Remove from Gmail takes the filter out and keeps the rule', async ({ page }) => {
    const ci = await openPanel(page, CI);
    await ci.getByRole('button', { name: 'Remove from Gmail' }).click();
    await expect(page.getByRole('dialog', { name: 'Removed from Gmail' })).toBeVisible();
    await expect(ci.getByText('Gmail could run this by itself once Sift is on.')).toBeVisible();
    await expect(ci.getByRole('listitem').last()).toContainText('Removed from Gmail');

    await page.reload();
    await expect(ci.getByText('Gmail could run this by itself once Sift is on.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ci).toHaveCount(0);
    await expect(ruleRows(page)).toHaveCount(4);
    await expect(ruleRows(page).filter({ hasText: 'In Gmail' })).toHaveCount(0);
  });

  test('with Sift on, Add to Gmail… shows the filter first, and adds it', async ({ page }) => {
    await turnOn(page);
    const news = await openPanel(page, 'anyone at news.example.com');
    await expect(news.getByText('Gmail could run this by itself.')).toBeVisible();

    await news.getByRole('button', { name: 'Add to Gmail…' }).click();
    const ask = page.getByRole('dialog', { name: 'Add it to Gmail as a filter?' });
    await expect(ask.getByRole('code')).toHaveText('from:(@news.example.com)');
    // Closing it takes back only the question.
    await page.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);
    await expect(news).toBeVisible();

    await news.getByRole('button', { name: 'Add to Gmail…' }).click();
    await ask.getByRole('button', { name: 'Add to Gmail', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Added to Gmail as a filter' })).toBeVisible();
    await expect(ask).toHaveCount(0);
    await expect(news.getByText('Gmail runs this rule as a filter.')).toBeVisible();
    await expect(news.getByRole('listitem').last()).toContainText('Added to Gmail');

    await news.getByRole('button', { name: 'Close' }).click();
    await expect(row(page, 'anyone at news.example.com')).toContainText('In Gmail');
  });

  test('with Sift on, a rule Gmail could run is offered as a filter once added', async ({ page }) => {
    await turnOn(page);
    await page.goto('/rules');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('someone@example.com');
    await addRule(dialog);

    const ask = page.getByRole('dialog', { name: 'Add it to Gmail as a filter?' });
    await expect(ask.getByRole('code')).toHaveText('from:(someone@example.com)');
    await ask.getByRole('button', { name: 'Add to Gmail', exact: true }).click();
    const opened = rulePanel(page, 'someone@example.com');
    await expect(opened.getByText('Gmail runs this rule as a filter.')).toBeVisible();
    await expect(ask).toHaveCount(0);
  });

  test('Not now adds the rule without its filter', async ({ page }) => {
    await turnOn(page);
    await page.goto('/rules');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('someone@example.com');
    await addRule(dialog);

    await page.getByRole('dialog', { name: 'Add it to Gmail as a filter?' }).getByRole('button', { name: 'Not now' }).click();
    const opened = rulePanel(page, 'someone@example.com');
    await expect(opened.getByText('Gmail could run this by itself.')).toBeVisible();
    await expect(opened.getByRole('button', { name: 'Add to Gmail…' })).toBeVisible();
  });

  test('a rule that is a filter can be removed, filter and all', async ({ page }) => {
    const ci = await openPanel(page, CI);
    await ci.getByRole('button', { name: 'Remove', exact: true }).click();
    await ci.getByRole('group', { name: 'Remove this rule?' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('dialog', { name: `Mail from ${CI}`, exact: true })).toBeVisible();
    await expect(ci).toHaveCount(0);
    await expect(ruleRows(page)).toHaveCount(3);
    await expect(row(page, CI)).toHaveCount(0);
  });
});
