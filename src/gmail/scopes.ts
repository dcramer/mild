/**
 * The full set of Google scopes sift requests.
 * `gmail.modify` covers reading, labels and history; `gmail.settings.basic` covers filters.
 * `gmail.send` and `https://mail.google.com/` (permanent delete) are deliberately absent.
 */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.settings.basic'] as const;
