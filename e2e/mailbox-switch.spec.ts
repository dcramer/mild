import type { Page } from '@playwright/test';
import { expect, test, PHONE } from './fixture.ts';
import { phoneMenu } from './navigation.ts';
import { reviewRows } from './review.ts';
import { mailboxesAsked } from './network.ts';
import { WORK, mailboxChoice, switchMailbox } from './mailboxes.ts';

// A desktop and a phone each name it in a place of their own.
const named = (page: Page) => page.getByRole('main').getByText(WORK, { exact: true }).filter({ visible: true });

const NOTHING_WAITING = 'Nothing is waiting on you.';

/** Opens the account menu and expects `mailbox` ticked in it. */
async function shown(page: Page, mailbox: string) {
  await page.getByRole('button', { name: /^Account, / }).click();
  await expect(mailboxChoice(page, mailbox)).toBeChecked();
}

test('one mailbox chosen in the account menu narrows For review to it, names it at the top of the page, and outlasts a reload', async ({ page }) => {
  const asked = mailboxesAsked(page, '/api/suggestions');
  await page.goto('/');
  await expect(reviewRows(page).first()).toBeVisible();
  await shown(page, 'All mailboxes');
  await page.keyboard.press('Escape');

  await switchMailbox(page, WORK);
  await expect(page.getByText(NOTHING_WAITING)).toBeVisible();
  await expect(reviewRows(page)).toHaveCount(0);
  await expect(named(page)).toBeVisible();
  expect(asked.at(-1)).toBe(WORK);

  await page.reload();
  await expect(page.getByText(NOTHING_WAITING)).toBeVisible();
  await expect(named(page)).toBeVisible();
  await shown(page, WORK);
  await mailboxChoice(page, 'All mailboxes').click();
  await expect(reviewRows(page).first()).toBeVisible();
  await expect(named(page)).toHaveCount(0);
  expect(asked.at(-1)).toBeNull();
});

test('a mailbox kept in the browser that is no longer theirs shows all of them, and is never asked for', async ({ page }) => {
  await page.addInitScript("localStorage.setItem('sift:mailbox', 'gone@example.org')");
  const asked = mailboxesAsked(page, '/api/suggestions');
  await page.goto('/');
  await expect(reviewRows(page).first()).toBeVisible();
  await shown(page, 'All mailboxes');
  expect(asked).not.toContain('gone@example.org');
});

test('on a phone the switch is in the menu, under the account, and choosing closes the menu on the narrowed list', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  // A phone's row has no answer of its own: the panel it opens does.
  await expect(page.getByRole('cell', { name: /Lunch on Thursday\?/ })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = phoneMenu(page);
  await menu.getByRole('combobox', { name: 'Mailbox, All mailboxes' }).click();
  await page.getByRole('option', { name: WORK, exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByText(NOTHING_WAITING)).toBeVisible();
  await expect(named(page)).toBeVisible();
});
