import { expect, type Page } from '@playwright/test';

/** The seed's first mailbox, the signed-in person's primary. */
export const ME = 'me@example.org';

/** The seed's second mailbox, which holds no mail. */
export const WORK = 'me@work.example.org';

/** `mailbox`, or All mailboxes, among the account menu's choices once it is open, on a desktop. */
export const mailboxChoice = (page: Page, mailbox: string) => page.getByRole('menu').getByRole('menuitemradio', { name: mailbox, exact: true });

/** Shows `mailbox`, or All mailboxes, from the account menu, on a desktop. */
export async function switchMailbox(page: Page, mailbox: string) {
  await page.getByRole('button', { name: /^Account, / }).click();
  await mailboxChoice(page, mailbox).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}
