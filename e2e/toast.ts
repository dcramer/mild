import { expect, type Page } from '@playwright/test';

/**
 * Hides the page and shows it again, as switching away and back does: an answer held until its toast goes is sent.
 * A string, as e2e is typed without the DOM.
 */
export const putAway = (page: Page) =>
  page.evaluate(
    "for (const state of ['hidden', 'visible']) { Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); } delete document.visibilityState",
  );

/** Where toasts show. */
export const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' });

/** A toast, named by what it is about: a rule's by the rule, a label's by the label. */
export const toast = (page: Page, name: string) => toasts(page).getByRole('dialog', { name, exact: true });

/** Closes a toast without Undo, which sends what it held. */
export const dismiss = async (page: Page, name: string) => {
  await toast(page, name).getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast(page, name)).toHaveCount(0);
};

/** A failure's toast, as it is announced: Base UI hides the toast itself from assistive technology and says it as an alert. */
export const failureToast = (page: Page, title: string) => page.getByRole('alert').filter({ hasText: title });
