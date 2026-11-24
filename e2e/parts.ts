import type { Locator, Page } from '@playwright/test';

/** A row of a list, found by the text of one of its cells (rows have no name of their own). */
export const row = (page: Page, text: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: text }) });

/** Picks `option` from a row's or the panel's "What this message is" dropdown. */
export async function choose(within: Locator, option: string) {
  await within.getByRole('combobox', { name: 'What this message is' }).click();
  await within.page().getByRole('option', { name: option, exact: true }).click();
}

/** A sender's or domain's card, open on `name` (as the name shown, or the address). */
export const senderCard = (page: Page, name: string) => page.getByRole('group', { name: `About ${name}`, exact: true });

/** The section under a heading, with everything in it. */
export const section = (within: Page | Locator, heading: string) =>
  within.getByRole('heading', { name: heading, exact: true }).locator('xpath=ancestor::section[1]');
