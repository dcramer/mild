import { expect, type Locator, type Page } from '@playwright/test';
import { toast } from './toast.ts';

/**
 * Mail sent from the composer, which is held while its toast says Sending, as Undo send holds it: dismissing the toast
 * sends it at once, and the toast says Sent once Gmail has it.
 */
export async function sendNow(page: Page, title: string) {
  const held = toast(page, title);
  await expect(held).toContainText('Sending');
  await held.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast(page, title)).toContainText('Sent');
}

/** The composer, by its title: new mail in a panel of its own, a reply or a forward in the reader. */
export const composer = (page: Page, title: 'New message' | 'Reply' | 'Reply to all' | 'Forward') =>
  page.getByRole(title === 'New message' ? 'dialog' : 'region', { name: title, exact: true });

/**
 * A draft's To, Cc or Bcc: the box typed in, and its chips, each named as its address is written
 * (`Ada Lovelace <ada@example.org>`).
 */
export function recipients(writing: Locator, line: 'To' | 'Cc' | 'Bcc') {
  const held = writing.getByRole('group', { name: line, exact: true }).first();
  return {
    input: writing.getByRole('combobox', { name: line, exact: true }),
    chip: (name: string) => held.getByLabel(name, { exact: true }),
    chips: held.getByRole('button', { name: /^Remove / }),
  };
}

/** A message Gmail was asked to send, its headers unfolded by name and its text decoded. */
export function readSent(raw: string): { headers: Record<string, string>; text: string } {
  const split = raw.indexOf('\r\n\r\n');
  const lines = raw.slice(0, split).replaceAll('\r\n ', ' ').split('\r\n');
  const headers = Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]));
  return { headers, text: Buffer.from(raw.slice(split + 4).replaceAll('\r\n', ''), 'base64').toString('utf8') };
}
