import type { Page } from '@playwright/test';
import { PHONE, WORK, boxOf, composer, expect, panelHeading, param, readSent, reviewRows, sideScroll, switchMailbox, test, toast, toasts } from './sift.ts';

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

  test('on a phone it covers the screen, and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/?compose=new');
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
