import { addRule, fact, openRule, ruleDialog, rulePanel, ruleRows } from './rule.ts';
import { expect, panel, row, test } from './sift.ts';

test.describe('Rules', () => {
  test('a rule written by hand opens on its panel, and takes the mail it covers off For review', async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = ruleDialog(page);
    await expect(dialog.getByRole('textbox', { name: 'What should it do?' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Fill in the rule' })).toBeDisabled();

    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    const add = dialog.getByRole('button', { name: 'Add rule', exact: true });
    await expect(add).toBeDisabled();
    await expect(dialog.getByRole('combobox', { name: 'Condition 1' })).toContainText('from');
    await expect(dialog.getByRole('combobox', { name: 'Label it as' })).toContainText('No label, just act');
    await expect(dialog.getByRole('combobox', { name: 'What happens to it' })).toContainText('Archive');

    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('deals@promo.example.com');
    await expect(dialog.getByText('Only this address.')).toBeVisible();
    await expect(add).toBeEnabled();
    await addRule(dialog);

    await expect(dialog).toHaveCount(0);
    const opened = rulePanel(page, 'deals@promo.example.com');
    await expect(fact(opened, 'Then')).toHaveText('Archive');
    await expect(fact(opened, 'Used')).toHaveText('1 time, last just now');
    await expect(opened.getByRole('cell', { name: '48 hours only: 30% off' })).toBeVisible();
    expect(openRule(page)).toMatch(/^r-/);

    await opened.getByRole('button', { name: 'Close' }).click();
    await expect(opened).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    // Sorted by use, the new rule has caught Deals and the Spam rule below it has not.
    await expect(ruleRows(page)).toHaveCount(5);
    const rules = await ruleRows(page).allTextContents();
    const first = (text: string) => rules.findIndex((rule) => rule.startsWith(text));
    expect(first('deals@promo.example.com')).toBeLessThan(first('anyone at promo.example.com'));

    await page.getByRole('link', { name: 'For review' }).click();
    await expect(page.getByRole('link', { name: 'For review 11' })).toBeVisible();
    await expect(row(page, 'Notes from the review')).toBeVisible();
    await expect(row(page, '48 hours only: 30% off')).toHaveCount(0);
  });

  test('Fill in the rule drafts the form from the words, and says what it left out', async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = ruleDialog(page);
    const words = dialog.getByRole('textbox', { name: 'What should it do?' });
    await words.fill('Archive the deals from promo');
    await dialog.getByRole('button', { name: 'Fill in the rule' }).click();

    await expect(dialog.getByRole('textbox', { name: 'Value 1' })).toHaveValue('deals@promo.example.com');
    await expect(dialog.getByRole('combobox', { name: 'Condition 1' })).toContainText('from');
    await expect(dialog.getByText('Not in this rule')).toBeVisible();
    await expect(dialog.getByText('Add another rule for grace@example.net.')).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Label it as' })).toContainText('No label, just act');
    await expect(dialog.getByRole('combobox', { name: 'What happens to it' })).toContainText('Archive');
    await expect(dialog.getByRole('checkbox', { name: 'Mark it read' })).toBeChecked();

    await dialog.getByRole('button', { name: 'Describe it instead' }).click();
    await expect(words).toHaveValue('Archive the deals from promo');
    await dialog.getByRole('button', { name: 'Fill in the rule' }).click();
    await addRule(dialog);

    await expect(fact(rulePanel(page, 'deals@promo.example.com'), 'Then')).toHaveText('Archive, marked read');
  });

  test('several values read back as one rule, and the list says its name', async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('example.com');
    await expect(dialog.getByText('Mail from anyone at example.com.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add a condition' }).click();
    await dialog.getByRole('textbox', { name: 'Value 2' }).fill('shop@example.net');
    await dialog.getByRole('button', { name: 'Add a condition' }).click();
    await dialog.getByRole('combobox', { name: 'Condition 3' }).click();
    await page.getByRole('option', { name: 'subject contains', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Value 3' }).fill('receipt');
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Shop receipts');
    await expect(dialog.getByText('Mail from shop@example.net or from anyone at example.com, with a subject containing “receipt”.')).toBeVisible();
    await addRule(dialog);

    const opened = rulePanel(page, 'Shop receipts');
    await expect(fact(opened, 'Mail')).toHaveText(/shop@example\.net.*example\.com.*receipt/);
    await opened.getByRole('button', { name: 'Close' }).click();
    await expect(row(page, 'Shop receipts')).toContainText('Archive');
  });

  test('a rule with the conditions of one already there replaces it', async ({ page }) => {
    await page.goto('/rules');
    await expect(row(page, 'anyone at promo.example.com')).toContainText('Spam');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('promo.example.com');
    await expect(dialog.getByText('Mail from anyone at promo.example.com.')).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Replaces' })).toHaveText(/Spam$/);
    await addRule(dialog);

    await rulePanel(page, 'anyone at promo.example.com').getByRole('button', { name: 'Close' }).click();
    await expect(ruleRows(page)).toHaveCount(4);
    await expect(row(page, 'anyone at promo.example.com')).toContainText('Archive');
  });

  test('closing the dialog adds nothing and leaves the address as it was', async ({ page }) => {
    await page.goto('/rules');
    const dialog = ruleDialog(page);
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await dialog.getByRole('textbox', { name: 'What should it do?' }).fill('Archive the deals from promo');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Add a rule' }).click();
    // Each opening starts on the question, empty.
    await expect(dialog.getByRole('textbox', { name: 'What should it do?' })).toHaveValue('');
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('deals@promo.example.com');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await expect(ruleRows(page)).toHaveCount(4);
    expect(new URL(page.url()).search).toBe('');
  });

  test("a rule's panel steps through the list, is its own address, and closes to the list", async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('cell', { name: 'anyone at news.example.com' }).click();
    const news = rulePanel(page, 'anyone at news.example.com');
    await expect(news.getByText('1 of 4')).toBeVisible();
    await expect(news.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await expect(fact(news, 'Is')).toHaveText('Newsletters');
    await expect(fact(news, 'Used')).toHaveText(/^2 times, last /);
    await expect(news.getByRole('cell', { name: 'This week in widgets' })).toBeVisible();
    const first = openRule(page);

    await news.getByRole('button', { name: 'Next' }).click();
    const shop = rulePanel(page, 'orders@shop.example.com');
    await expect(shop.getByText('2 of 4')).toBeVisible();
    const second = openRule(page);
    expect(second).not.toBe(first);

    await page.goto(`/rules?rule=${first}`);
    await expect(news).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(news).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    await expect(ruleRows(page)).toHaveCount(4);
  });

  test("a message the rule decided opens over the rule's panel, and closing it returns there", async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('sale@store.example.com');
    await addRule(dialog);
    const opened = rulePanel(page, 'sale@store.example.com');
    const rule = openRule(page);

    await opened.getByRole('cell', { name: 'Winter sale starts now' }).click();
    const message = panel(page);
    await expect(message.getByRole('heading', { name: 'Winter sale starts now' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('message')).toBe('m8');

    await message.getByRole('button', { name: 'Close' }).click();
    await expect(message).toHaveCount(0);
    await expect(opened).toBeVisible();
    expect(new URL(page.url()).search).toBe(`?rule=${rule}`);
  });

  test('removing a rule from its panel asks in place, and Cancel keeps it', async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('cell', { name: 'anyone at promo.example.com' }).click();
    const opened = rulePanel(page, 'anyone at promo.example.com');
    const ask = opened.getByRole('group', { name: 'Remove this rule?' });

    await opened.getByRole('button', { name: 'Remove', exact: true }).click();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toHaveCount(0);
    await expect(opened).toBeVisible();

    await opened.getByRole('button', { name: 'Remove', exact: true }).click();
    await ask.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Rule removed: from anyone at promo.example.com' })).toBeVisible();
    await expect(opened).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    await expect(ruleRows(page)).toHaveCount(3);
    await expect(row(page, 'anyone at promo.example.com')).toHaveCount(0);
  });

  test('removing a rule from its row asks in the row, and opens no panel', async ({ page }) => {
    await page.goto('/rules');
    const promo = row(page, 'anyone at promo.example.com');
    await promo.getByRole('button', { name: 'Remove' }).click();
    const ask = promo.getByRole('group', { name: 'Remove this rule?' });
    await expect(ask).toBeVisible();
    await expect(rulePanel(page, 'anyone at promo.example.com')).toHaveCount(0);

    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toHaveCount(0);
    await promo.getByRole('button', { name: 'Remove' }).click();
    await page.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);

    await promo.getByRole('button', { name: 'Remove' }).click();
    await ask.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(promo).toHaveCount(0);
    await expect(ruleRows(page)).toHaveCount(3);
    await expect(rulePanel(page, 'anyone at promo.example.com')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });

  test('Escape on Remove this rule? in a panel takes back the question and leaves the panel open', async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('cell', { name: 'anyone at promo.example.com' }).click();
    const opened = rulePanel(page, 'anyone at promo.example.com');
    await opened.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(opened.getByRole('group', { name: 'Remove this rule?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opened.getByRole('group', { name: 'Remove this rule?' })).toHaveCount(0);
    await opened.getByRole('button', { name: 'Previous' }).click({ timeout: 2000 });
    await expect(rulePanel(page, 'anyone at ci.example.org')).toBeVisible();
  });

  test('Undo takes the rule back, and its panel goes from the page and the address', async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('someone@example.com');
    await addRule(dialog);
    await expect(rulePanel(page, 'someone@example.com')).toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('dialog', { name: 'Rule taken back' })).toBeVisible();
    await expect(rulePanel(page, 'someone@example.com')).toHaveCount(0);
    await expect(ruleRows(page)).toHaveCount(4);
    expect(new URL(page.url()).search).toBe('');
  });
});
