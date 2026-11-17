import type { Locator, Page } from '@playwright/test';
import { expect } from './sift.ts';

export const ruleDialog = (page: Page) => page.getByRole('dialog', { name: 'Add a rule' });

/** The toast for a rule just added, named by the rule it says. */
export const ruleToast = (page: Page, rule: string) => page.getByRole('region', { name: 'Notifications' }).getByRole('dialog', { name: rule, exact: true });

/** A rule's panel, by its title: its name, or its conditions. */
export const rulePanel = (page: Page, title: string) => page.getByRole('dialog', { name: title, exact: true });

/** What a panel's `term` says. */
export const fact = (within: Locator, term: string) =>
  within
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');

/**
 * Presses Add rule with `Apply to mail already there` unticked: ticked, it opens Apply to your inbox, which
 * reads Gmail, and the 409 it gets here is a console error the fixture fails on.
 */
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

/** The rule a panel shows, from the address that holds it open. */
export const openRule = (page: Page) => new URL(page.url()).searchParams.get('rule');

/** Settings, Active, Turn on, Turn on again to confirm, and Not now to going through the inbox. Add to Gmail is offered only while Sift is on. */
export async function turnOn(page: Page) {
  await page.goto('/?settings=1');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Turn on', exact: true }).click();
  await settings.getByRole('group', { name: 'Archive, label and mark spam on new mail by itself?' }).getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('dialog', { name: 'Go through your inbox?' }).getByRole('button', { name: 'Not now' }).click();
  await expect(settings.getByText('On', { exact: true })).toBeVisible();
}

/** The rows of the Rules list, top to bottom, without its header. */
export const ruleRows = (page: Page) => page.getByRole('main').getByRole('rowgroup').last().getByRole('row');
