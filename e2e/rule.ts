import type { Locator, Page } from '@playwright/test';
import { expect } from './fixture.ts';
import { path } from './wait.ts';
import { choose } from './parts.ts';

export const ruleDialog = (page: Page) => page.getByRole('dialog', { name: 'Add a rule' });

/** Presses `within`'s Make a rule…, which opens the dialog started on what that place knows. */
export async function makeRule(within: Locator) {
  await within.getByRole('button', { name: 'Make a rule…' }).click();
  return ruleDialog(within.page());
}

/** A message's Make a rule…, at the end of the list of what it is, as every label picker ends. */
export async function ruleFromMessage(within: Locator) {
  await choose(within, 'Make a rule…');
  return ruleDialog(within.page());
}

/** On Rules, Add a rule and Write it yourself: the dialog, on its empty form. */
export async function writeRule(page: Page) {
  await page.getByRole('button', { name: 'Add a rule' }).click();
  const dialog = ruleDialog(page);
  await dialog.getByRole('button', { name: 'Write it yourself' }).click();
  return dialog;
}

/** A rule's panel, by its title: its name, or its conditions. */
export const rulePanel = (page: Page, title: string) => page.getByRole('dialog', { name: title, exact: true });

/** Opens a rule's panel from the Rules list. */
export async function openRule(page: Page, title: string) {
  await page.goto('/rules');
  await page.getByRole('cell', { name: title }).click();
  return rulePanel(page, title);
}

/** What a panel's `term` says. */
export const fact = (within: Locator, term: string) =>
  within
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');

/** Presses Add rule with `Apply to mail already there` unticked, so that Apply to your inbox does not open over the rule's panel. */
export async function addRule(dialog: Locator) {
  const add = dialog.getByRole('button', { name: 'Add rule', exact: true });
  await expect(add).toBeVisible();
  const apply = dialog.getByRole('checkbox', { name: 'Apply to mail already there' });
  if ((await apply.count()) > 0) await apply.uncheck();
  await add.click();
  await expect(
    dialog
      .page()
      .getByRole('region', { name: 'Notifications' })
      .getByText(/^Rule (added|replaced)$/),
  ).toBeVisible();
}

/** The rule whose panel is open, once the address is its own (`/rules/<id>`). */
export async function ruleId(page: Page) {
  await path(page).toMatch(/^\/rules\/r-/);
  return decodeURIComponent(new URL(page.url()).pathname.split('/')[2]!);
}

/** The rows of the Rules list, top to bottom, without its header. */
export const ruleRows = (page: Page) => page.getByRole('main').getByRole('rowgroup').last().getByRole('row');

/** Goes to Rules, which lists the seed's four rules and nothing more. */
export async function seededRulesOnly(page: Page) {
  await page.goto('/rules');
  await expect(ruleRows(page)).toHaveCount(4);
}

/** Presses Remove… in a rule's panel, or the trash can in its row, and Remove in the question it opens. */
export async function removeRule(within: Locator) {
  await within.getByRole('button', { name: /^Remove(…| this rule)$/ }).click();
  await removeQuestion(within.page()).getByRole('button', { name: 'Remove', exact: true }).click();
}

export const removeQuestion = (page: Page) => page.getByRole('dialog', { name: 'Remove this rule?' });

/** The rule For review proposes from what the seed's user has been doing. */
export const proposal = (page: Page) => page.getByRole('row').filter({ hasText: 'Keep Receipts from billing@utility.example.net?' });

/** A standing button (Trust, Unwanted, Block) in the group for `who`; `aria-pressed` says whether it is theirs. */
export const standing = (page: Page, who: string, name: string) =>
  page.getByRole('group', { name: `Where ${who} stands`, exact: true }).getByRole('button', { name, exact: true });
