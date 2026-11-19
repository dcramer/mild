import type { Page } from '@playwright/test';
import {
  PHONE,
  WORK,
  boxOf,
  composer,
  expect,
  inboxRow,
  panelHeading,
  param,
  readSent,
  reader,
  reviewRows,
  sideScroll,
  switchMailbox,
  test,
  toast,
  toasts,
} from './sift.ts';

const ME = 'me@example.org';
const compose = (page: Page) => page.getByRole('button', { name: /Compose/ });

test.describe('with Inbox on', () => {
  test.use({ variant: 'inbox' });

  test('C writes a new message, each address checked as it is typed, and Ctrl+Enter sends it from the chosen address', async ({ page, sift }) => {
    await page.goto('/');
    // Drawn by the server; its key is bound once the page has loaded.
    await expect(reviewRows(page).first()).toBeVisible();
    await page.keyboard.press('c');
    const writing = composer(page, 'New message');
    const to = writing.getByRole('textbox', { name: 'To' });
    await expect(to).toBeFocused();
    await expect(writing.getByRole('combobox', { name: 'From' })).toContainText(ME);

    await page.keyboard.type('ada@example.org, nope');
    // Still being typed.
    await expect(writing.getByText('“nope” is not an address.')).toHaveCount(0);
    await writing.getByRole('textbox', { name: 'Subject' }).click();
    await expect(writing.getByText('“nope” is not an address.')).toBeVisible();
    await expect(writing.getByRole('button', { name: /^Send/ })).toBeDisabled();

    await to.fill('Ada <ada@example.org>');
    await writing.getByRole('button', { name: 'Cc', exact: true }).click();
    await expect(writing.getByRole('textbox', { name: 'Cc' })).toBeFocused();
    await page.keyboard.type('grace@example.net');
    await writing.getByRole('combobox', { name: 'From' }).click();
    await page.getByRole('option', { name: 'me+lists@example.org' }).click();
    await writing.getByRole('textbox', { name: 'Subject' }).fill('Lunch');
    await writing.getByRole('textbox', { name: 'Message' }).fill('See you at noon.\nBring the plans.');
    await page.keyboard.press('Control+Enter');

    await expect(toast(page, 'Lunch')).toContainText('Sent');
    await expect(writing).toHaveCount(0);
    await param(page, 'compose').toBeNull();
    const [sent, ...more] = sift.sent();
    expect(more).toEqual([]);
    expect(sent!.mailbox).toBe(ME);
    const { headers, text } = readSent(sent!.raw);
    expect(headers).toMatchObject({ From: 'me+lists@example.org', To: '"Ada" <ada@example.org>', Cc: 'grace@example.net', Subject: 'Lunch' });
    expect(text).toBe('See you at noon.\r\nBring the plans.');

    // Sent, it is not kept as a draft.
    await compose(page).click();
    await expect(composer(page, 'New message').getByRole('textbox', { name: 'To' })).toHaveValue('');
  });

  test('what is written is kept in the browser through a reload, and a draft discarded can be had back', async ({ page }) => {
    await page.goto('/');
    await compose(page).click();
    const writing = composer(page, 'New message');
    await writing.getByRole('textbox', { name: 'To' }).fill('ada@example.org');
    await writing.getByRole('textbox', { name: 'Message' }).fill('Half written');
    await page.reload();
    await expect(writing.getByRole('textbox', { name: 'Message' })).toHaveValue('Half written');
    await expect(writing.getByRole('textbox', { name: 'To' })).toHaveValue('ada@example.org');

    await writing.getByRole('button', { name: 'Discard' }).click();
    await expect(writing).toHaveCount(0);
    await toast(page, 'To ada@example.org').getByRole('button', { name: /^Undo/ }).click();
    await expect(writing.getByRole('textbox', { name: 'Message' })).toHaveValue('Half written');
  });

  test('from a mailbox Google has not let Sift send from, it says so and offers the press that asks', async ({ page, sift }) => {
    await page.goto('/');
    await switchMailbox(page, WORK);
    await page.keyboard.press('c');
    const writing = composer(page, 'New message');
    await expect(writing.getByText(`Sift may not send from ${WORK} yet`)).toBeVisible();
    await expect(writing.getByRole('link', { name: 'Let Sift send' })).toHaveAttribute(
      'href',
      `/auth/login?${new URLSearchParams({ grant: 'send', mailbox: WORK, to: '/?compose=new' }).toString()}`,
    );
    await writing.getByRole('textbox', { name: 'To' }).fill('ada@example.org');
    await expect(writing.getByRole('button', { name: /^Send/ })).toBeDisabled();

    await writing.getByRole('combobox', { name: 'From' }).click();
    await page.getByRole('option', { name: ME, exact: true }).click();
    await expect(writing.getByRole('link', { name: 'Let Sift send' })).toHaveCount(0);
    await expect(writing.getByRole('button', { name: /^Send/ })).toBeEnabled();
    expect(sift.sent()).toEqual([]);
  });

  test('a reply is from the mailbox its message came to, whichever is chosen, to its sender, in its conversation', async ({ page, sift }) => {
    await page.goto('/');
    await switchMailbox(page, WORK);
    await page.goto('/?message=m6&compose=reply');
    const writing = composer(page, 'Reply');
    await expect(writing.getByText('Re: Lunch on Thursday?')).toBeVisible();
    await expect(writing.getByRole('combobox', { name: 'From' })).toContainText(ME);
    await expect(writing.getByRole('textbox', { name: 'To' })).toHaveValue('Ada Lovelace <ada@example.org>');
    await expect(writing.getByRole('textbox', { name: 'Subject' })).toHaveCount(0);
    await expect(writing.getByRole('textbox', { name: 'Message' })).toBeFocused();
    await page.keyboard.type('Thursday works.');
    await writing.getByRole('button', { name: /^Send/ }).click();

    await expect(toast(page, 'Re: Lunch on Thursday?')).toContainText('Sent');
    // The message it answers is still open under it.
    await expect(panelHeading(page, 'Lunch on Thursday?')).toBeVisible();
    const [sent] = sift.sent();
    expect(sent).toMatchObject({ mailbox: ME, threadId: 't6' });
    expect(readSent(sent!.raw).headers).toMatchObject({
      From: ME,
      To: '"Ada Lovelace" <ada@example.org>',
      Subject: 'Re: Lunch on Thursday?',
      'In-Reply-To': '<thursday@example.org>',
      References: '<lunch@example.org> <thursday@example.org>',
    });
  });

  test('R in the reader replies to the conversation, and the reply sent is in it, with the reader where it was', async ({ page, sift }) => {
    await page.goto('/inbox');
    await inboxRow(page, 'Lunch on Thursday?').getByRole('cell').nth(2).click();
    const open = reader(page);
    // Its key is bound once the press is drawn.
    await expect(open.getByRole('button', { name: /^Reply all/ })).toBeVisible();
    await page.keyboard.press('r');
    const writing = composer(page, 'Reply');
    await expect(writing.getByRole('textbox', { name: 'To' })).toHaveValue('Ada Lovelace <ada@example.org>');
    await expect(writing.getByRole('textbox', { name: 'Message' })).toBeFocused();
    await page.keyboard.type('Thursday works.');
    await page.keyboard.press('Control+Enter');

    await expect(toast(page, 'Re: Lunch on Thursday?')).toContainText('Sent');
    await expect(writing).toHaveCount(0);
    await expect(open.getByRole('row').filter({ hasText: 'Thursday works.' })).toContainText(ME);
    // Back on the reader, not on its first link, whose card would open over the conversation.
    await expect(open).toBeFocused();
    expect(readSent(sift.sent()[0]!.raw).headers).toMatchObject({ 'In-Reply-To': '<thursday@example.org>' });
  });

  test('Forward quotes the message under what is written, and sends it as new mail', async ({ page, sift }) => {
    await page.goto('/inbox');
    await inboxRow(page, 'Lunch on Thursday?').getByRole('cell').nth(2).click();
    await reader(page)
      .getByRole('button', { name: /^Forward/ })
      .click();
    const writing = composer(page, 'Forward');
    const to = writing.getByRole('textbox', { name: 'To' });
    await expect(to).toBeFocused();
    await expect(writing.getByRole('textbox', { name: 'Subject' })).toHaveValue('Fwd: Lunch on Thursday?');
    await page.keyboard.type('grace@example.net');
    await writing.getByRole('textbox', { name: 'Message' }).focus();
    await page.keyboard.type('Are you free too?');
    await writing.getByRole('button', { name: /^Send/ }).click();

    await expect(toast(page, 'Fwd: Lunch on Thursday?')).toContainText('Sent');
    const { headers, text } = readSent(sift.sent()[0]!.raw);
    expect(headers).toMatchObject({ To: 'grace@example.net', Subject: 'Fwd: Lunch on Thursday?' });
    expect(headers['In-Reply-To']).toBeUndefined();
    expect(text).toMatch(/^Are you free too\?\r\n\r\n---------- Forwarded message ---------\r\nFrom: Ada Lovelace <ada@example\.org>\r\nDate: .+\r\n/);
    expect(text).toContain('Subject: Lunch on Thursday?\r\nTo: Me <me@example.org>\r\n\r\nAre you free for lunch on Thursday?');
  });

  test('on a phone Inbox has the press that writes, it covers the screen, and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/inbox');
    await compose(page).click();
    const writing = composer(page, 'New message');
    await writing.getByRole('textbox', { name: 'To' }).fill('someone.with.a.very.long.address@a-long-domain.example.com');
    await expect(writing.getByRole('button', { name: /^Send/ })).toBeEnabled();
    await sideScroll(page).toBe(0);
    expect((await boxOf(writing)).width).toBe(PHONE.width);
  });
});

test('with Inbox off, nothing offers to write mail', async ({ page }) => {
  await page.goto('/?compose=new');
  await expect(reviewRows(page).first()).toBeVisible();
  await page.keyboard.press('c');
  await expect(compose(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(toasts(page).getByRole('dialog')).toHaveCount(0);
});
