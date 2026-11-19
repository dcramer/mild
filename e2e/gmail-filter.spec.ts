import { addRule, openRule, removeRule, rulePanel, ruleRows, writeRule } from './rule.ts';
import { expect, row, test, toast, turnOn } from './sift.ts';

const CI = 'anyone at ci.example.org';

test.describe('A rule as a Gmail filter', () => {
  test("each rule's panel says where it stands as a Gmail filter, and only a filter is marked on the list", async ({ page }) => {
    await page.goto('/rules');
    await expect(ruleRows(page)).toHaveCount(4);
    await expect(ruleRows(page).filter({ hasText: 'Gmail filter' })).toHaveCount(1);
    await expect(row(page, CI)).toContainText('Gmail filter');

    const ci = await openRule(page, CI);
    await expect(ci.getByText('Gmail runs this rule itself, as one of your Gmail filters')).toBeVisible();
    await expect(ci.getByRole('button', { name: 'Remove filter…' })).toBeVisible();

    const news = await openRule(page, 'anyone at news.example.com');
    await expect(news.getByText('Once Sift is on, Gmail could run this rule itself')).toBeVisible();
    await expect(news.getByRole('listitem').last()).toContainText('Gmail did not take the filter');
    await expect(news.getByRole('button', { name: 'Add as a Gmail filter…' })).toHaveCount(0);

    const shop = await openRule(page, 'orders@shop.example.com');
    await expect(shop.getByText('Its Gmail filter was deleted in Gmail. Sift will not put it back.')).toBeVisible();
    await expect(shop.getByRole('listitem').last()).toContainText('Filter deleted in Gmail');
    await expect(shop.getByRole('button', { name: /Gmail/ })).toHaveCount(0);

    const promo = await openRule(page, 'anyone at promo.example.com');
    await expect(promo.getByText('Gmail can’t run this rule as one of its filters. Gmail filters cannot mark mail as spam.')).toBeVisible();
    await expect(promo.getByRole('button', { name: /Gmail/ })).toHaveCount(0);
  });

  test('Remove filter takes the filter out and keeps the rule', async ({ page }) => {
    const ci = await openRule(page, CI);
    await ci.getByRole('button', { name: 'Remove filter…' }).click();
    const ask = page.getByRole('dialog', { name: 'Remove the Gmail filter?' });
    await expect(ask).toContainText('The rule stays, and applies only while Sift is on.');
    await ask.getByRole('button', { name: 'Remove filter', exact: true }).click();
    await expect(ask).toHaveCount(0);
    await expect(toast(page, 'Gmail filter removed')).toBeVisible();
    await expect(ci.getByText('Once Sift is on, Gmail could run this rule itself')).toBeVisible();
    await expect(ci.getByRole('listitem').last()).toContainText('Filter removed');

    await page.reload();
    await expect(ci.getByText('Once Sift is on, Gmail could run this rule itself')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ci).toHaveCount(0);
    await expect(ruleRows(page)).toHaveCount(4);
    await expect(ruleRows(page).filter({ hasText: 'Gmail filter' })).toHaveCount(0);
  });

  test('with Sift on, Add as a Gmail filter… shows the filter first, and adds it', async ({ page }) => {
    await turnOn(page);
    const news = await openRule(page, 'anyone at news.example.com');
    await expect(news.getByText('Gmail could run this rule itself')).toBeVisible();

    await news.getByRole('button', { name: 'Add as a Gmail filter…' }).click();
    const ask = page.getByRole('dialog', { name: 'Add it to Gmail as a filter?' });
    await expect(ask.getByRole('code')).toHaveText('from:(@news.example.com)');
    // Closing it takes back only the question.
    await page.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);
    await expect(news).toBeVisible();

    await news.getByRole('button', { name: 'Add as a Gmail filter…' }).click();
    await ask.getByRole('button', { name: 'Add to Gmail', exact: true }).click();
    await expect(toast(page, 'Added to Gmail as a filter')).toBeVisible();
    await expect(ask).toHaveCount(0);
    await expect(news.getByText('Gmail runs this rule itself, as one of your Gmail filters')).toBeVisible();
    // Written to each of the seed's two mailboxes, so each row says which.
    const added = news.getByRole('listitem').filter({ hasText: 'Filter added' });
    await expect(added).toHaveCount(2);
    await expect(added.filter({ hasText: 'me@example.org' })).toHaveCount(1);
    await expect(added.filter({ hasText: 'me@work.example.org' })).toHaveCount(1);

    await news.getByRole('button', { name: 'Close' }).click();
    await expect(row(page, 'anyone at news.example.com')).toContainText('Gmail filter');
  });

  test('with Sift on, a rule Gmail could run is offered as a filter once added', async ({ page }) => {
    await turnOn(page);
    await page.goto('/rules');
    const dialog = await writeRule(page);
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('someone@example.com');
    await addRule(dialog);

    const ask = page.getByRole('dialog', { name: 'Add it to Gmail as a filter?' });
    await expect(ask.getByRole('code')).toHaveText('from:(someone@example.com)');
    await ask.getByRole('button', { name: 'Add to Gmail', exact: true }).click();
    const opened = rulePanel(page, 'someone@example.com');
    await expect(opened.getByText('Gmail runs this rule itself, as one of your Gmail filters')).toBeVisible();
    await expect(ask).toHaveCount(0);
  });

  test('Not now adds the rule without its filter', async ({ page }) => {
    await turnOn(page);
    await page.goto('/rules');
    const dialog = await writeRule(page);
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('someone@example.com');
    await addRule(dialog);

    await page.getByRole('dialog', { name: 'Add it to Gmail as a filter?' }).getByRole('button', { name: 'Not now' }).click();
    const opened = rulePanel(page, 'someone@example.com');
    await expect(opened.getByText('Gmail could run this rule itself')).toBeVisible();
    await expect(opened.getByRole('button', { name: 'Add as a Gmail filter…' })).toBeVisible();
  });

  test('a rule that is a filter can be removed, filter and all', async ({ page }) => {
    const ci = await openRule(page, CI);
    await removeRule(ci);
    await expect(toast(page, `Mail from ${CI}`)).toBeVisible();
    await expect(ci).toHaveCount(0);
    await expect(ruleRows(page)).toHaveCount(3);
    await expect(row(page, CI)).toHaveCount(0);
  });
});
