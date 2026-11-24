import type { Page } from '@playwright/test';

/** For review's rows of mail, without its header. */
export const reviewRows = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('combobox', { name: 'What this message is' }) });

export const reviewSearch = (page: Page) => page.getByRole('searchbox', { name: 'Search senders and subjects' });
