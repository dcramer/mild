import { expect, type Locator, type Page } from '@playwright/test';

/** The reader: a message, or a conversation, open in the list's place. */
export const reader = (page: Page) => page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'What this message is' }) });

/** The reader's heading: the subject of what it shows. */
export const readerHeading = (page: Page, subject: string) => reader(page).getByRole('heading', { name: subject, level: 1 });
/** Whom an open message went to, under its head: its To or Cc row. */
export const addressed = (scope: Locator, label: 'To' | 'Cc') =>
  scope
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');

/** The reader's Back, to the list it was opened from. */
export const back = (page: Page) => reader(page).getByRole('button', { name: /^Back to / });

/** Opens the message in the list by its subject, once the reader shows it. */
export async function openMessage(page: Page, subject: string) {
  await page.getByRole('cell', { name: subject }).click();
  await expect(readerHeading(page, subject)).toBeVisible();
  return reader(page);
}
