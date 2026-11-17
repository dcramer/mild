import { addRule, fact, openRule, ruleDialog, rulePanel, ruleRows } from './rule.ts';
import { expect, panel, row, test } from './sift.ts';

const PROPOSAL = 'Keep Receipts from billing@utility.example.net?';

test.describe('Rules from a shortcut', () => {
  test('a proposal opens the dialog on its sender, its label and what the user has been doing', async ({ page }) => {
    await page.goto('/');
    const proposal = page.getByRole('listitem').filter({ hasText: PROPOSAL });
    await expect(proposal).toContainText('You kept the last 3, but the label archives them.');
    await proposal.getByRole('button', { name: 'Make a rule…' }).click();
    const dialog = ruleDialog(page);
    await expect(dialog.getByRole('textbox', { name: 'What should it do?' })).toHaveValue(
      'Mail from billing@utility.example.net, once it is Receipts: leave it in the inbox.',
    );
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await expect(dialog.getByRole('combobox', { name: 'Condition 1' })).toContainText('from');
    await expect(dialog.getByRole('textbox', { name: 'Value 1' })).toHaveValue('billing@utility.example.net');
    await expect(dialog.getByRole('combobox', { name: 'Only when it is this label' })).toContainText('Receipts');
    await expect(dialog.getByRole('combobox', { name: 'What happens to it' })).toContainText('Keep');
    await expect(dialog.getByText('A model reads each message it matches to tell.')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(proposal).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });

  test('adding the rule from a proposal, changed, resolves the proposal', async ({ page }) => {
    await page.goto('/');
    const proposal = page.getByRole('listitem').filter({ hasText: PROPOSAL });
    await proposal.getByRole('button', { name: 'Make a rule…' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('textbox', { name: 'Value 1' }).fill('utility.example.net');
    await expect(dialog.getByText('Mail from anyone at utility.example.net.')).toBeVisible();
    await addRule(dialog);

    const opened = rulePanel(page, 'anyone at utility.example.net');
    await expect(fact(opened, 'Then')).toHaveText('Leave in inbox');
    expect(openRule(page)).toMatch(/^r-/);
    await expect(proposal).toHaveCount(0);
    await opened.getByRole('button', { name: 'Close' }).click();
    await expect(opened).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');

    await page.getByRole('link', { name: 'Rules' }).click();
    await expect(row(page, 'anyone at utility.example.net as Receipts')).toContainText('Leave in inbox');
  });

  test('Dismiss takes the proposal away in one press and makes no rule', async ({ page }) => {
    await page.goto('/');
    const proposal = page.getByRole('listitem').filter({ hasText: PROPOSAL });
    await proposal.getByRole('button', { name: 'Dismiss' }).click();
    await expect(proposal).toHaveCount(0);
    await expect(ruleDialog(page)).toHaveCount(0);

    await page.reload();
    await expect(row(page, 'Notes from the review')).toBeVisible();
    await expect(proposal).toHaveCount(0);
    await page.goto('/rules');
    await expect(ruleRows(page)).toHaveCount(4);
  });

  test("a message's Make a rule… and Keep as… open over its panel, which closing the dialog leaves", async ({ page }) => {
    await page.goto('/?message=m8&account=me%40example.org');
    const message = panel(page);
    const dialog = ruleDialog(page);

    await message.getByRole('button', { name: 'Make a rule…' }).click();
    await expect(dialog.getByRole('textbox', { name: 'What should it do?' })).toHaveValue('Mail from sale@store.example.com is Marketing.');
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Value 1' })).toHaveValue('sale@store.example.com');
    await expect(dialog.getByRole('combobox', { name: 'Label it as' })).toContainText('Marketing');
    expect(new URL(page.url()).searchParams.get('message')).toBe('m8');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(message).toBeVisible();

    await message.getByRole('button', { name: 'Keep as Marketing…' }).click();
    await expect(dialog.getByRole('textbox', { name: 'What should it do?' })).toHaveValue(
      'Mail from sale@store.example.com, once it is Marketing: leave it in the inbox.',
    );
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(message).toBeVisible();
    expect(new URL(page.url()).search).toBe('?message=m8&account=me%40example.org');
  });

  test("a rule added from a message opens over it, and closing the rule's panel returns to the message", async ({ page }) => {
    await page.goto('/?message=m8&account=me%40example.org');
    const message = panel(page);
    await message.getByRole('button', { name: 'Make a rule…' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await addRule(dialog);

    const opened = rulePanel(page, 'sale@store.example.com');
    await expect(fact(opened, 'Is')).toHaveText('Marketing');
    const params = new URL(page.url()).searchParams;
    expect(params.get('message')).toBe('m8');
    expect(params.get('rule')).toMatch(/^r-/);

    await opened.getByRole('button', { name: 'Close' }).click();
    await expect(opened).toHaveCount(0);
    await expect(message.getByText('Rule: from sale@store.example.com is Marketing').first()).toBeVisible();
    expect(new URL(page.url()).search).toBe('?message=m8&account=me%40example.org');
  });

  test('a fact in a message starts the rule on it', async ({ page }) => {
    await page.goto('/?message=m8&account=me%40example.org');
    await panel(page).getByRole('button', { name: 'Make a rule for mail that came through a mailing list' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await expect(dialog.getByRole('combobox', { name: 'Condition 1' })).toContainText('on the list');
    await expect(dialog.getByRole('textbox', { name: 'Value 1' })).toHaveValue('store.example.com');
    await expect(dialog.getByRole('combobox', { name: 'What happens to it' })).toContainText('Archive');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });

  test("a sender's standing is a rule given in one press: another replaces it, Undo gives the last back, and pressing it again takes it back", async ({
    page,
  }) => {
    await page.goto('/sender/me%40example.org/ada%40example.org');
    const standing = page.getByRole('group', { name: 'Where Ada Lovelace stands' });
    const said = page.getByRole('dialog', { name: 'Rule added' });
    const pressed = async (on: string | null) => {
      for (const name of ['Trust', 'Unwanted', 'Block'])
        await expect(standing.getByRole('button', { name })).toHaveAttribute('aria-pressed', String(name === on));
    };

    await standing.getByRole('button', { name: 'Trust' }).click();
    await expect(said).toContainText('Mail from ada@example.org: leave it in the inbox.');
    // Keeping mail moves nothing, so there is nothing in the inbox to apply it to.
    await expect(said.getByRole('button', { name: 'Apply to inbox…' })).toHaveCount(0);
    await expect(ruleDialog(page)).toHaveCount(0);
    await pressed('Trust');
    await expect(page.getByRole('main').getByRole('link', { name: 'Mail from ada@example.org: Leave in inbox' })).toBeVisible();

    await standing.getByRole('button', { name: 'Block' }).click();
    await expect(said).toContainText('Mail from ada@example.org: send it to spam.');
    await expect(said.getByRole('button', { name: 'Apply to inbox…' })).toBeVisible();
    await pressed('Block');
    await said.getByRole('button', { name: 'Undo' }).click();
    await pressed('Trust');

    await standing.getByRole('button', { name: 'Trust' }).click();
    await pressed(null);
    await page.goto('/rules');
    await expect(ruleRows(page)).toHaveCount(4);
    await expect(row(page, 'ada@example.org')).toHaveCount(0);
  });

  test('Undo takes back a standing that replaced none', async ({ page }) => {
    await page.goto('/sender/me%40example.org/ada%40example.org');
    const standing = page.getByRole('group', { name: 'Where Ada Lovelace stands' });
    await standing.getByRole('button', { name: 'Unwanted' }).click();
    await expect(standing.getByRole('button', { name: 'Unwanted' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('z');
    await expect(standing.getByRole('button', { name: 'Unwanted' })).toHaveAttribute('aria-pressed', 'false');
    await page.goto('/rules');
    await expect(row(page, 'ada@example.org')).toHaveCount(0);
  });

  test('a standing for a sender whose own rule says more opens the dialog, which says what it replaces', async ({ page }) => {
    await page.goto('/sender/me%40example.org/orders%40shop.example.com');
    const standing = page.getByRole('group', { name: /stands$/ });
    await standing.getByRole('button', { name: 'Block' }).click();
    const dialog = ruleDialog(page);
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await expect(dialog.getByRole('group', { name: 'Replaces' })).toContainText('Receipts');
    await expect(dialog.getByRole('combobox', { name: 'What happens to it' })).toContainText('Spam');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(standing.getByRole('button', { name: 'Block' })).toHaveAttribute('aria-pressed', 'false');
  });

  test("a sender's page starts a rule on the sender, and one per name it writes under", async ({ page }) => {
    await page.goto('/sender/me%40example.org/notifications%40code.example.com');
    const dialog = ruleDialog(page);
    const words = dialog.getByRole('textbox', { name: 'What should it do?' });
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Make a rule…' })).toHaveCount(5);

    await main.getByRole('button', { name: 'Make a rule…' }).first().click();
    await expect(words).toHaveValue('Mail from notifications@code.example.com is Notifications.');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await row(page, 'Dependabot').getByRole('button', { name: 'Make a rule…' }).click();
    await expect(words).toHaveValue('Mail from notifications@code.example.com named “Dependabot” is Notifications.');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    await expect(panel(page)).toHaveCount(0);
  });

  test("a domain's standing that is already a rule shows as pressed, and another replaces it in one press", async ({ page }) => {
    await page.goto('/domain/me%40example.org/promo.example.com');
    const standing = page.getByRole('group', { name: 'Where promo.example.com stands' });
    await expect(standing.getByRole('button', { name: 'Block' })).toHaveAttribute('aria-pressed', 'true');

    await standing.getByRole('button', { name: 'Unwanted' }).click();
    await expect(page.getByRole('dialog', { name: 'Rule added' })).toContainText('Mail from promo.example.com: archive it.');
    await expect(standing.getByRole('button', { name: 'Unwanted' })).toHaveAttribute('aria-pressed', 'true');
    await expect(standing.getByRole('button', { name: 'Block' })).toHaveAttribute('aria-pressed', 'false');
    await expect(ruleDialog(page)).toHaveCount(0);
  });
});
