import { expect, type Page } from '@playwright/test';
import { section } from './parts.ts';
import { param } from './wait.ts';

export const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true });

/** Settings' Active section: This browser has a Turn on and Turn off of its own, for keyboard shortcuts. */
export const settingsActive = (page: Page) => section(settings(page), 'Active');

/** The question Turn on asks in Settings before Mild changes anything in Gmail. */
export const turnOnQuestion = (page: Page) => settingsActive(page).getByRole('group', { name: 'Archive, label and mark spam on new mail by itself?' });

export const goThrough = (page: Page) => page.getByRole('dialog', { name: 'Go through your inbox?' });

/** Opens Settings from the account menu, over the page showing. */
export async function settingsFromMenu(page: Page) {
  await page.getByRole('button', { name: /^Account, / }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(settings(page)).toBeVisible();
}

/** Closes Settings, which takes it out of the address. */
export async function closeSettings(page: Page) {
  await settings(page).getByRole('button', { name: 'Close' }).click();
  await expect(settings(page)).toHaveCount(0);
  await param(page, 'settings').toBeNull();
}

/** In open Settings, Turn on and Turn on again to confirm, which leaves the offer to go through the inbox open. */
export async function confirmTurnOn(page: Page) {
  await settingsActive(page).getByRole('button', { name: 'Turn on', exact: true }).click();
  await turnOnQuestion(page).getByRole('button', { name: 'Turn on', exact: true }).click();
}

/** Opens Settings, turns Mild on and says Not now to going through the inbox. */
export async function turnOn(page: Page) {
  await page.goto('/?settings=1');
  await confirmTurnOn(page);
  await goThrough(page).getByRole('button', { name: 'Not now' }).click();
  await expect(settingsActive(page).getByText('On', { exact: true })).toBeVisible();
}

/** Settings' Inbox section. */
export const settingsInbox = (page: Page) => section(settings(page), 'Inbox');

/** The dialog that asks how far back Inbox keeps the mail: turning it on, or Change… while it is. */
export const mailWindow = (page: Page) => page.getByRole('dialog', { name: /^Keep how much/ });
