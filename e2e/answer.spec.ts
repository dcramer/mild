import type { Page } from '@playwright/test';
import { choose, expect, panel, row, test } from './sift.ts';

/** The masthead's link to For review, whose name ends in how many messages wait. */
const waitingLink = (page: Page) => page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^For review/ });
const toast = (page: Page, name: string) => page.getByRole('region', { name: 'Notifications' }).getByRole('dialog', { name, exact: true });

/** How many rules Rules lists, read from the page. */
async function ruleCount(page: Page) {
  await page.goto('/rules');
  const rules = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Remove', exact: true }) });
  await expect(rules.first()).toBeVisible();
  return rules.count();
}

test.describe('Answering mail', () => {
  test('agreeing from a row answers it, opens nothing and makes no rule', async ({ page }) => {
    const rules = await ruleCount(page);
    await page.goto('/');
    await expect(waitingLink(page)).toHaveAccessibleName('For review 12');

    await row(page, 'Winter sale starts now').getByRole('button', { name: 'Agree: Marketing' }).click();
    await expect(toast(page, 'Archive as Marketing')).toBeVisible();
    await expect(row(page, 'Winter sale starts now')).toHaveCount(0);
    await expect(waitingLink(page)).toHaveAccessibleName('For review 11');
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');

    expect(await ruleCount(page)).toBe(rules);
    await expect(page.getByRole('main')).not.toContainText('sale@store.example.com');
  });

  test('choosing another label only changes the check until it is pressed', async ({ page }) => {
    await page.goto('/');
    const store = row(page, 'Winter sale starts now');
    await choose(store, 'Notifications');
    await expect(store.getByRole('button', { name: 'Save: Notifications' })).toBeVisible();
    await expect(store.getByRole('button', { name: 'Agree: Marketing' })).toHaveCount(0);
    await expect(waitingLink(page)).toHaveAccessibleName('For review 12');
    await expect(panel(page)).toHaveCount(0);

    await store.getByRole('button', { name: 'Save: Notifications' }).click();
    await expect(toast(page, 'Archive as Notifications')).toBeVisible();
    await expect(store).toHaveCount(0);
  });

  test('a folded row is answered as all of its messages', async ({ page }) => {
    await page.goto('/');
    const dependabot = row(page, '3 messages');
    await expect(dependabot.getByRole('cell', { name: 'Bump lodash from 4.17.20 to 4.17.21' })).toBeVisible();
    await dependabot.getByRole('button', { name: 'Agree: Notifications' }).click();
    await expect(toast(page, 'Archive as Notifications: 3 messages')).toBeVisible();
    await expect(dependabot).toHaveCount(0);
    await expect(waitingLink(page)).toHaveAccessibleName('For review 9');
    await expect(row(page, '2 messages')).toBeVisible();
  });

  // Deals (m4), the recipe's last row, is left out: its HTML's blocked image and script are console errors to the fixture.
  test('answering in the panel saves the label, and the last one closes the panel', async ({ page }) => {
    await page.goto('/?q=Lunch');
    await page.getByRole('cell', { name: 'Lunch on Thursday?' }).click();
    const open = panel(page);
    await expect(open.getByRole('heading', { name: 'Lunch on Thursday?', level: 2 })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('message')).toBe('m6');
    await expect(open.getByRole('combobox', { name: 'What this message is' })).toHaveText('Which label?');
    await expect(open.getByRole('button', { name: 'Choose what it is first' })).toBeDisabled();

    await choose(open, 'Marketing');
    await open.getByRole('button', { name: 'Save: Marketing' }).click();
    await expect(toast(page, 'Archive as Marketing')).toBeVisible();
    await expect(open).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('message')).toBeNull();
    await expect(page.getByText('Nothing waiting matches.')).toBeVisible();
    await expect(waitingLink(page)).toHaveAccessibleName('For review 11');
  });

  test('an answer is for one message: the panel moves on to the sender’s other one, still unanswered', async ({ page }) => {
    const rules = await ruleCount(page);
    await page.goto('/');
    await page.getByRole('cell', { name: 'Replica lag on db-3' }).click();
    const open = panel(page);
    await choose(open, 'Notifications');
    await open.getByRole('button', { name: 'Save: Notifications' }).click();

    const said = toast(page, 'Archive as Notifications');
    await expect(said.getByRole('button', { name: 'Same for 1 more' })).toBeVisible();
    await expect(open.getByRole('heading', { name: 'Disk 91% full on db-2', level: 2 })).toBeVisible();
    await expect(open.getByRole('combobox', { name: 'What this message is' })).toHaveText('Which label?');

    await open.getByRole('button', { name: 'Close' }).click();
    await expect(open).toHaveCount(0);
    await expect(row(page, 'Disk 91% full on db-2')).toBeVisible();
    await expect(row(page, 'Replica lag on db-3')).toHaveCount(0);
    expect(await ruleCount(page)).toBe(rules);
  });

  test('“Same for 1 more” in the panel answers the message on show, which then says so', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Replica lag on db-3' }).click();
    const open = panel(page);
    await choose(open, 'Notifications');
    await open.getByRole('button', { name: 'Save: Notifications' }).click();
    await expect(open.getByRole('heading', { name: 'Disk 91% full on db-2', level: 2 })).toBeVisible();

    await toast(page, 'Archive as Notifications').getByRole('button', { name: 'Same for 1 more' }).click();
    await expect(toast(page, 'Archive as Notifications: 1 more')).toBeVisible();
    await expect(open.getByRole('heading', { name: 'Disk 91% full on db-2', level: 2 })).toBeVisible();
    await expect(open.getByRole('combobox', { name: 'What this message is' })).toHaveText('Notifications');
  });

  test('“Same for 1 more” leaves the panel where the reader has since stepped to', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Replica lag on db-3' }).click();
    const open = panel(page);
    await choose(open, 'Notifications');
    await open.getByRole('button', { name: 'Save: Notifications' }).click();
    await expect(open.getByRole('heading', { name: 'Disk 91% full on db-2', level: 2 })).toBeVisible();
    await open.getByRole('button', { name: 'Next' }).click();
    await expect(open.getByRole('heading', { name: 'Re: Fix the release script (#412)', level: 2 })).toBeVisible();

    await toast(page, 'Archive as Notifications').getByRole('button', { name: 'Same for 1 more' }).click();
    await expect(toast(page, 'Archive as Notifications: 1 more')).toBeVisible();
    await expect(open.getByRole('heading', { name: 'Re: Fix the release script (#412)', level: 2 })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('message')).toBe('m21');
  });

  test('“Same for 1 more” after the panel closed leaves a panel opened since open', async ({ page }) => {
    await page.goto('/?q=db-');
    await page.getByRole('cell', { name: 'Disk 91% full on db-2' }).click();
    await choose(panel(page), 'Notifications');
    await panel(page).getByRole('button', { name: 'Save: Notifications' }).click();
    await expect(panel(page)).toHaveCount(0);

    await page.getByRole('searchbox', { name: 'Search senders and subjects' }).fill('');
    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    await expect(panel(page).getByRole('heading', { name: 'Notes from the review', level: 2 })).toBeVisible();
    await toast(page, 'Archive as Notifications').getByRole('button', { name: 'Same for 1 more' }).click();
    await expect(toast(page, 'Archive as Notifications: 1 more')).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'Notes from the review', level: 2 })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('message')).toBe('m7');
  });

  test('“Same for 1 more” in the panel takes the message off the list behind it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Replica lag on db-3' }).click();
    const open = panel(page);
    await choose(open, 'Notifications');
    await open.getByRole('button', { name: 'Save: Notifications' }).click();
    await expect(open.getByRole('heading', { name: 'Disk 91% full on db-2', level: 2 })).toBeVisible();
    await toast(page, 'Archive as Notifications').getByRole('button', { name: 'Same for 1 more' }).click();
    await expect(toast(page, 'Archive as Notifications: 1 more')).toBeVisible();

    await open.getByRole('button', { name: 'Close' }).click();
    await expect(open).toHaveCount(0);
    await expect(waitingLink(page)).toHaveAccessibleName('For review 10');
    await expect(row(page, 'Disk 91% full on db-2')).toHaveCount(0);
  });

  test('“Same for 1 more” answers the sender’s other waiting message', async ({ page }) => {
    await page.goto('/');
    await choose(row(page, 'Replica lag on db-3'), 'Notifications');
    await row(page, 'Replica lag on db-3').getByRole('button', { name: 'Save: Notifications' }).click();
    await toast(page, 'Archive as Notifications').getByRole('button', { name: 'Same for 1 more' }).click();
    await expect(toast(page, 'Archive as Notifications: 1 more')).toBeVisible();
    await expect(row(page, 'Disk 91% full on db-2')).toHaveCount(0);
    await expect(waitingLink(page)).toHaveAccessibleName('For review 10');
    await expect(panel(page)).toHaveCount(0);
  });
});

test.describe('A rule from For review', () => {
  test('“Make a rule…” in the panel opens the dialog over it, and Escape returns to the panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Lunch on Thursday?' }).click();
    const open = panel(page);
    await open.getByRole('button', { name: 'Make a rule…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await expect(dialog.getByRole('textbox', { name: 'What should it do?' })).toHaveValue('Mail from ada@example.org: ');
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Value 1' })).toHaveValue('ada@example.org');
    expect(new URL(page.url()).searchParams.get('message')).toBe('m6');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open.getByRole('heading', { name: 'Lunch on Thursday?', level: 2 })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('message')).toBe('m6');

    // The panel has the keys again: the next Escape closes it.
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(row(page, 'Lunch on Thursday?')).toBeVisible();
  });

  test('keys pressed in the rule dialog stay in it, and do not step the panel behind', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    const open = panel(page);
    await open.getByRole('button', { name: 'Make a rule…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await dialog.getByRole('textbox', { name: 'What should it do?' }).pressSequentially(' jk');
    await dialog.getByRole('button', { name: 'Write it yourself' }).focus();
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open.getByRole('heading', { name: 'Notes from the review', level: 2 })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('message')).toBe('m7');
  });

  test('closing the rule dialog over the panel leaves the panel on the same message', async ({ page }) => {
    await page.goto('/?message=m8&account=me%40example.org');
    const open = panel(page);
    await expect(open.getByRole('heading', { name: 'Winter sale starts now', level: 2 })).toBeVisible();
    await open.getByRole('button', { name: 'Keep as Marketing…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await expect(dialog.getByRole('textbox', { name: 'What should it do?' })).toHaveValue(
      'Mail from sale@store.example.com, once it is Marketing: leave it in the inbox.',
    );
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(open.getByRole('heading', { name: 'Winter sale starts now', level: 2 })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('message')).toBe('m8');
  });

  test('the proposal’s “Make a rule…” opens only the rule dialog, and closing it keeps the proposal', async ({ page }) => {
    await page.goto('/');
    const proposal = page.getByRole('listitem').filter({ hasText: 'Keep Receipts from billing@utility.example.net?' });
    await expect(proposal).toContainText('You kept the last 3, but the label archives them.');
    await proposal.getByRole('button', { name: 'Make a rule…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await expect(dialog.getByRole('textbox', { name: 'What should it do?' })).toHaveValue(
      'Mail from billing@utility.example.net, once it is Receipts: leave it in the inbox.',
    );
    await expect(panel(page)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(proposal).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });

  test('dismissing the proposal removes it and makes no rule', async ({ page }) => {
    const rules = await ruleCount(page);
    await page.goto('/');
    const proposal = page.getByRole('listitem').filter({ hasText: 'Keep Receipts from billing@utility.example.net?' });
    await proposal.getByRole('button', { name: 'Dismiss' }).click();
    await expect(proposal).toHaveCount(0);

    await page.reload();
    await expect(row(page, 'Winter sale starts now')).toBeVisible();
    await expect(proposal).toHaveCount(0);
    expect(await ruleCount(page)).toBe(rules);
  });
});
