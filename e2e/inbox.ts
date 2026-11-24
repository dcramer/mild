import type { Page } from '@playwright/test';

/** Inbox's search, which looks through all the mail Mild keeps. */
export const inboxSearch = (page: Page) => page.getByRole('searchbox', { name: 'Search mail' });

/** Inbox's rows, each a conversation with a check to select it. Not on a phone, which has no checks. */
export const inboxRows = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: /^Select / }) });

/** The conversation in Inbox whose newest subject this is. */
export const inboxRow = (page: Page, subject: string) =>
  page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Select ${subject}`, exact: true }) });

/** A rule Mild proposes, as a row at the top of Inbox, by its words. */
export const proposedRule = (page: Page, words: string) =>
  page
    .getByRole('row')
    .filter({ hasText: words })
    .filter({ hasNot: page.getByRole('checkbox') });
