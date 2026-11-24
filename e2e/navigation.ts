import type { Locator, Page } from '@playwright/test';

/** What opens message `id` (`m6`) over a page, for after its `?` or `&`. */
export const messageQuery = (id: string) => `message=${id}`;

/** A sender's page, by their address. */
export const senderPage = (address: string) => `/sender/${encodeURIComponent(address)}`;

/** The page of a sender the seed has mail from: the code host's notifications. */
export const SENDER = senderPage('notifications@code.example.com');

/** A domain's page. */
export const domainPage = (domain: string) => `/domain/${domain}`;

/** The links to each screen: the rail on a desktop, in the menu on a phone. */
export const sections = (within: Page | Locator) => within.getByRole('navigation', { name: 'Sections' });

/** A phone's menu, which the masthead's button and a swipe in from the edge open. */
export const phoneMenu = (page: Page) => page.getByRole('dialog', { name: 'Menu' });

/** The link to For review among the sections, whose name ends in how many messages wait. */
export const forReviewLink = (page: Page) => sections(page).getByRole('link', { name: /^For review/ });

/** Inbox among the sections, there only while it is on. */
export const inboxLink = (page: Page) => sections(page).getByRole('link', { name: 'Inbox' });
