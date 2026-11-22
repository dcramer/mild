import {
  PHONE,
  back,
  choose,
  expect,
  forReviewLink,
  proposedRule,
  inboxLink,
  inboxRow,
  inboxRows,
  inboxSearch,
  mailWindow,
  param,
  patchJson,
  path,
  pointAt,
  reader,
  settings,
  settingsInbox,
  test,
  failureToast,
  toast,
  tooltip,
} from './sift.ts';

// Run in the page, which e2e is typed without: as text.
const OPEN_COPY = `new Promise((done) => (indexedDB.open('sift-copy').onsuccess = (event) => done(event.target.result)))`;
const ALL = (method: string) =>
  `new Promise((done) => (db.transaction('conversations').objectStore('conversations').${method}().onsuccess = (event) => done(event.target.result)))`;

/** How many conversations the copy on the device holds; none before the page has made it. */
const copied = `(async () => {
  if (!(await indexedDB.databases()).some((d) => d.name === 'sift-copy')) return 0;
  const db = await ${OPEN_COPY};
  const count = await ${ALL('count')};
  db.close();
  return count;
})()`;

/** Whether `words` can be read anywhere in what the copy keeps on the device. */
const diskHolds = (words: string) => `(async () => {
  const db = await ${OPEN_COPY};
  const rows = await ${ALL('getAll')};
  db.close();
  return rows.some((row) => JSON.stringify(row).includes(${JSON.stringify(words)}) || new TextDecoder().decode(row.sealed.data).includes(${JSON.stringify(words)}));
})()`;

/** The names of the page's databases. */
const databases = '(async () => (await indexedDB.databases()).map((d) => d.name))()';

test.describe('Inbox, off', () => {
  test('is turned on in Settings, after saying what it keeps, and then is a section listing the inbox', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Inbox is off' })).toBeVisible();
    await expect(inboxLink(page)).toHaveCount(0);

    await page.goto('/?settings=1');
    await settingsInbox(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    await mailWindow(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    await expect(settingsInbox(page).getByRole('button', { name: 'Turn off', exact: true })).toBeVisible();
    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(settings(page)).toHaveCount(0);

    await inboxLink(page).click();
    await path(page).toBe('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
  });
});

test.describe('Inbox', () => {
  test.use({ variant: 'inbox' });

  test('lists conversations newest first, with what Mild thinks of each, and narrows by it', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await expect(inboxRows(page).first()).toContainText('This week in widgets');
    await expect(inboxRows(page).first()).toContainText('Newsletters');
    await expect(inboxRow(page, 'Your March bill')).toContainText('Utility3');

    await page.getByRole('radio', { name: 'Sorted' }).click();
    await param(page, 'view').toBe('sorted');
    await expect(inboxRows(page)).toHaveCount(10);
    await expect(inboxRow(page, 'This week in widgets')).toBeVisible();
    await page.getByRole('radio', { name: 'Needs you' }).click();
    await expect(inboxRows(page)).toHaveCount(9);
    await expect(inboxRow(page, 'This week in widgets')).toHaveCount(0);
    await inboxSearch(page).fill('utility');
    await expect(inboxRows(page)).toHaveCount(1);
  });

  test('draws a large inbox a hundred conversations at a time, the next as the end of the list comes near', async ({ page }) => {
    // The whole copy's first page, with 230 more conversations as old as the oldest.
    await patchJson(page, '**/api/sync*', (feed) => {
      if (!feed.reset) return feed;
      const { conversation } = feed.conversations.at(-1);
      const more = Array.from({ length: 230 }, (_, i) => {
        const threadId = `many-${i}`;
        const messages = conversation.messages.map((m: { receivedAt: number }) => ({
          ...m,
          messageId: `${threadId}-m`,
          receivedAt: m.receivedAt - (i + 1) * 60_000,
        }));
        return { accountId: conversation.accountId, threadId, conversation: { ...conversation, threadId, messages } };
      });
      return { ...feed, conversations: [...feed.conversations, ...more] };
    });
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(100);
    await inboxRows(page).last().scrollIntoViewIfNeeded();
    await expect(inboxRows(page)).toHaveCount(200);
    await inboxRows(page).last().scrollIntoViewIfNeeded();
    await expect(inboxRows(page)).toHaveCount(249);
  });

  test('a row’s label is changed in place: saved at once, the conversation left in the inbox, and picked again to undo', async ({ page, sift }) => {
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    // On the bar the row shows while pointed at.
    const label = async () => {
      await pointAt(row);
      return row.getByRole('combobox', { name: 'What Your order has shipped is' });
    };
    const pick = async (name: string) => {
      await (await label()).click();
      const saved = page.waitForResponse('**/api/feedback');
      await page.getByRole('option', { name, exact: true }).click();
      await saved;
    };
    await expect(await label()).toContainText('Receipts');

    await pick('Personal');
    await expect(reader(page)).toHaveCount(0);
    await page.reload();
    await expect(await label()).toContainText('Personal');
    expect(sift.google().mailbox('me@example.org').message('m3')!.labelIds).toContain('INBOX');

    await pick('Receipts');
    await page.reload();
    await expect(await label()).toContainText('Receipts');
    await expect(inboxRows(page)).toHaveCount(19);
    expect(sift.google().mailbox('me@example.org').message('m3')!.labelIds).toContain('INBOX');
  });

  test('the reader’s answer is saved and the conversation stays open', async ({ page }) => {
    await page.goto('/inbox');
    await inboxRow(page, 'Your order has shipped').getByRole('cell').nth(2).click();
    const open = reader(page);
    const saved = page.waitForResponse('**/api/feedback');
    await choose(open, 'Personal');
    await saved;
    await expect(open.getByRole('heading', { name: 'Your order has shipped', level: 1 })).toBeVisible();
    await expect(open.getByRole('combobox', { name: 'What this message is' })).toContainText('Personal');
    await back(page).click();
    const row = inboxRow(page, 'Your order has shipped');
    await pointAt(row);
    await expect(row.getByRole('combobox', { name: 'What Your order has shipped is' })).toContainText('Personal');
  });

  test('opens from the copy kept in this browser, encrypted, without asking the server for the list', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await expect.poll(() => page.evaluate<number>(copied)).toBe(19);

    // The feed never answers: the list is the one on the device.
    await page.route('**/api/sync**', () => {});
    const asked: string[] = [];
    page.on('request', (request) => void (request.url().includes('/api/mail/threads') && asked.push(request.url())));
    await page.reload();
    await expect(inboxRows(page)).toHaveCount(19);
    await expect(inboxRows(page).first()).toContainText('This week in widgets');
    expect(asked).toEqual([]);
    // Nothing of the mail is readable on the disk.
    expect(await page.evaluate<boolean>(diskHolds('This week in widgets'))).toBe(false);
  });

  test('a conversation archived stays gone once the feed has it, and the copy goes at sign-out', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await pointAt(inboxRow(page, 'This week in widgets'));
    await inboxRow(page, 'This week in widgets').getByRole('button', { name: 'Archive' }).click();
    await expect(inboxRows(page)).toHaveCount(18);
    await expect.poll(() => page.evaluate<number>(copied)).toBe(18);
    await page.reload();
    await expect(inboxRows(page)).toHaveCount(18);

    await page.getByRole('button', { name: /^Account, / }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: /^Account, / })).toHaveCount(0);
    await expect.poll(() => page.evaluate<string[]>(databases)).not.toContain('sift-copy');
  });

  test('is the section For review was: / opens it, and its icon carries what waits on the reader', async ({ page }) => {
    await page.goto('/');
    await path(page).toBe('/inbox');
    await expect(forReviewLink(page)).toHaveCount(0);
    await expect(inboxLink(page)).toContainText('12');
  });

  test('a rule Mild proposes is a row from Mild at the top, which opens on why and the mail it is about, and is dismissed there', async ({ page }) => {
    await page.goto('/inbox');
    const proposal = proposedRule(page, 'Keep Receipts from billing@utility.example.net?');
    await expect(page.getByRole('main').getByRole('row').nth(1)).toContainText('Mild');
    await proposal.getByRole('cell').nth(2).click();
    await param(page, 'proposal').not.toBeNull();
    const view = page.getByRole('region', { name: 'Keep Receipts from billing@utility.example.net?' });
    await expect(view.getByText('You kept the last 3, but the label archives them.')).toBeVisible();
    await expect(view.getByRole('row').filter({ hasText: 'Your March bill' })).toBeVisible();

    await view.getByRole('button', { name: 'Dismiss' }).click();
    await param(page, 'proposal').toBeNull();
    await expect(inboxRow(page, 'Your March bill')).toBeVisible();
    await expect(proposal).toHaveCount(0);
  });

  test('Make a rule… on a proposed rule opens the rule dialog started on it', async ({ page }) => {
    await page.goto('/inbox');
    const proposal = proposedRule(page, 'Keep Receipts from billing@utility.example.net?');
    await pointAt(proposal);
    await proposal.getByRole('button', { name: 'Make a rule…' }).click();
    await expect(page.getByRole('dialog', { name: /rule/i })).toBeVisible();
  });

  test('Spam marks the conversation spam in Gmail, and Undo puts it back', async ({ page, sift }) => {
    await page.goto('/inbox');
    const deal = inboxRow(page, '48 hours only: 30% off');
    const id = (await deal.getAttribute('data-holds'))!.split('/')[1]!;
    await pointAt(deal);
    await deal.getByRole('button', { name: 'Spam' }).click();
    await expect(deal).toHaveCount(0);
    await expect(toast(page, '48 hours only: 30% off')).toBeVisible();
    await expect.poll(() => sift.google().mailbox('me@example.org').message(id)!.labelIds).toContain('SPAM');
    expect(sift.google().mailbox('me@example.org').message(id)!.labelIds).not.toContain('INBOX');

    await toast(page, '48 hours only: 30% off').getByRole('button', { name: /^Undo/ }).click();
    await expect(deal).toBeVisible();
    expect(sift.google().mailbox('me@example.org').message(id)!.labelIds).toContain('INBOX');
  });

  test('Block sender gives them Blocked and marks their conversation spam, with one Undo', async ({ page, sift }) => {
    await page.goto('/inbox');
    const sale = inboxRow(page, 'Winter sale starts now');
    const id = (await sale.getAttribute('data-holds'))!.split('/')[1]!;
    await pointAt(sale);
    await sale.getByRole('button', { name: 'Block sender' }).click();
    await expect(sale).toHaveCount(0);
    const blocked = toast(page, 'Blocked sale@store.example.com');
    await expect(blocked).toBeVisible();
    await expect.poll(() => sift.google().mailbox('me@example.org').message(id)!.labelIds).toContain('SPAM');

    await blocked.getByRole('button', { name: /^Undo/ }).click();
    await expect(sale).toBeVisible();
    await page.goto('/sender/sale%40store.example.com');
    await expect(page.getByRole('radio', { name: 'Blocked', checked: true })).toHaveCount(0);
  });

  test('J and K move, O opens a conversation with its unread open, and opening it marks it read', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    // The rule Mild proposes is the first row; the mail starts after it.
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await expect(inboxRows(page).first()).toBeFocused();
    await page.keyboard.press('o');
    await expect(reader(page).getByRole('heading', { name: 'This week in widgets', level: 1 })).toBeVisible();
    await expect(reader(page).getByText('Five stories about widgets.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reader(page)).toHaveCount(0);

    await inboxRow(page, 'Your March bill').getByRole('cell').nth(2).click();
    const open = reader(page);
    await expect(open.getByRole('heading', { name: 'Your March bill', level: 1 })).toBeVisible();
    // Unread, every message starts open.
    await expect(open.getByRole('article')).toHaveCount(3);
    // Answered as Receipts, as its row says, though Mild could not place it.
    await expect(open.getByRole('combobox', { name: 'What this message is' })).toContainText('Receipts');
    // In Inbox, Mild's reason waits for Why.
    await expect(open.getByText(/^Your answer\. Mild said: /)).toHaveCount(0);
    await open.getByRole('button', { name: 'Why' }).click();
    await expect(open.getByText(/^Your answer\. Mild said: /)).toBeVisible();
    await expect(open.getByRole('link', { name: 'Utility', exact: true })).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);

    // Read, it opens folded to all but its newest, each row saying when it came, short, not how long ago.
    await inboxRow(page, 'Your March bill').getByRole('cell').nth(2).click();
    await expect(open.getByRole('article')).toHaveCount(1);
    const folded = open.getByRole('button', { name: /^Utility/, expanded: false });
    await expect(folded).toHaveCount(2);
    await expect(folded.first().locator('time')).toHaveText(/^([A-Z][a-z]{2} \d{1,2}, )?\d{1,2}:\d{2} [AP]M$/);
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);

    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('checkbox', { name: 'Unread' }).check();
    await param(page, 'unread').toBe('1');
    await expect(inboxRows(page)).toHaveCount(17);
    await expect(inboxRow(page, 'Your March bill')).toHaveCount(0);
  });

  test('in the reader E archives the conversation and goes on to the next, and Shift+U marks it unread and closes it', async ({ page }) => {
    await page.goto('/inbox');
    await inboxRow(page, 'This week in widgets').getByRole('cell').nth(2).click();
    const open = reader(page);
    await expect(open.getByRole('button', { name: /^Archive/ })).toBeEnabled();
    await page.keyboard.press('e');
    await expect(toast(page, 'This week in widgets')).toBeVisible();
    await expect(open.getByRole('heading', { name: 'Widgets, part two', level: 1 })).toBeVisible();
    await page.keyboard.press('Shift+U');
    // Closed once Gmail has it.
    await expect(open).toHaveCount(0);
    await page.goto('/inbox?unread=1');
    await expect(inboxRow(page, 'Widgets, part two')).toBeVisible();
  });

  test('pointed at, a row puts its label, Archive, Spam and Block sender in place of its time, which act on it alone', async ({ page }) => {
    await page.goto('/inbox');
    const row = inboxRow(page, 'Widgets, part two');
    const label = row.getByRole('combobox', { name: 'What Widgets, part two is' });
    await expect(label).toBeHidden();
    await expect(row.getByRole('button', { name: 'Archive' })).toBeHidden();
    await expect(row.getByRole('cell').last()).toHaveText(/\d:\d\d [AP]M/);
    await pointAt(row);
    await expect(row.getByRole('cell').last().locator('time')).toBeHidden();
    await expect(label).toBeVisible();
    await expect(label).toContainText('Newsletters');
    await expect(row.getByRole('button', { name: 'Spam' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Block sender' })).toBeVisible();
    await expect(row.getByRole('button', { name: /^Mark (un)?read$/ })).toHaveCount(0);
    await pointAt(row.getByRole('button', { name: 'Archive' }));
    await expect(tooltip(page)).toHaveText('Archive');

    // A row whose check was pressed keeps the focus, but shows its presses no longer once the pointer moves on.
    const other = inboxRow(page, 'This week in widgets');
    await other.getByRole('checkbox').check();
    await pointAt(row);
    await expect(other.getByRole('button', { name: 'Archive' })).toBeHidden();
    await row.getByRole('button', { name: 'Archive' }).click();
    await expect(toast(page, 'Widgets, part two')).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(inboxRows(page)).toHaveCount(18);

    // Read and unread are for what is selected.
    const read = page.waitForResponse('**/api/mail/change');
    await page.keyboard.press('Shift+I');
    await read;
    await page.goto('/inbox?unread=1');
    await expect(inboxRows(page).first()).toBeVisible();
    await expect(inboxRow(page, 'This week in widgets')).toHaveCount(0);
    await expect(inboxRow(page, 'Widgets, part two')).toHaveCount(0);
  });

  test('mail Mild could not place is marked before its time, and its label says so when pointed at', async ({ page }) => {
    await page.goto('/inbox');
    const unplaced = inboxRow(page, '48 hours only: 30% off');
    const placed = inboxRow(page, 'Your order has shipped');
    const mark = (row: typeof placed) => row.getByRole('cell').last().getByText('Unlabelled', { exact: true }).filter({ visible: true });
    await expect(mark(unplaced)).toHaveCount(1);
    await expect(mark(placed)).toHaveCount(0);
    // Pointed at, the bar takes the mark's place and says it in words.
    await pointAt(unplaced);
    await expect(unplaced.getByRole('combobox', { name: 'What 48 hours only: 30% off is' })).toHaveText('Unlabelled');
  });

  test('X selects, E archives what is selected, and Undo puts it back', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    // The rule Mild proposes is the first row; the mail starts after it.
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    const bar = page.getByRole('toolbar', { name: 'Selected rows' });
    await expect(bar).toContainText('2 selected');
    await page.keyboard.press('e');
    await expect(toast(page, '2 conversations')).toBeVisible();
    await expect(inboxRows(page)).toHaveCount(17);
    await expect(inboxRow(page, 'This week in widgets')).toHaveCount(0);
    await expect(bar).toHaveCount(0);

    await page.keyboard.press('z');
    await expect(inboxRows(page)).toHaveCount(19);
    await expect(inboxRow(page, 'This week in widgets')).toBeVisible();
  });

  test('when Gmail takes only some of what is selected, what it took can still be undone, and the page says the rest failed', async ({ page }) => {
    await page.route('**/api/mail/change', async (route) => {
      const reply = (await (await route.fetch()).json()) as { actions: number[] };
      await route.fulfill({ json: { actions: reply.actions.slice(1), missed: 1 } });
    });
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    // The rule Mild proposes is the first row; the mail starts after it.
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await page.keyboard.press('e');
    await expect(toast(page, '2 conversations').getByRole('button', { name: /^Undo/ })).toBeVisible();
    await expect(failureToast(page, 'Could not archive them')).toContainText('Gmail did not take all of them. Try again.');
  });

  test('the search finds words in a message’s text, as they are typed, and an archived conversation says it is out of the inbox', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    // Only in the text of the order's message.
    await inboxSearch(page).fill('104');
    await expect(inboxRows(page)).toHaveCount(1);
    await expect(inboxRow(page, 'Your order has shipped')).toBeVisible();
    await inboxSearch(page).fill('order 1042 way');
    await param(page, 'q').toBe('order 1042 way');
    await expect(inboxRows(page)).toHaveCount(1);
    await inboxSearch(page).fill('order 1043');
    await expect(page.getByText('No mail matches.')).toBeVisible();

    await inboxSearch(page).fill('');
    await expect(inboxRows(page)).toHaveCount(19);
    await inboxRow(page, 'Your order has shipped').getByRole('cell').nth(2).click();
    await reader(page)
      .getByRole('button', { name: /^Archive/ })
      .click();
    await expect(toast(page, 'Your order has shipped')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inboxRows(page)).toHaveCount(18);

    await inboxSearch(page).fill('1042');
    await expect(inboxRows(page)).toHaveCount(1);
    await expect(inboxRow(page, 'Your order has shipped')).toContainText('Archived');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE });

    test('reads as a mail app, and archiving from the reader goes on to the next conversation', async ({ page }) => {
      await page.goto('/inbox');
      const widgets = page.getByRole('row').filter({ hasText: 'Widgets, part two' });
      await expect(widgets).toContainText('Weekly Digest');
      await expect(widgets).toContainText('Newsletters');
      await widgets.click();
      const open = reader(page);
      await expect(open.getByRole('heading', { name: 'Widgets, part two', level: 1 })).toBeVisible();
      await open.getByRole('button', { name: 'Archive', exact: true }).click();
      await expect(open.getByRole('heading', { name: 'Your order has shipped', level: 1 })).toBeVisible();
      await expect(toast(page, 'Widgets, part two')).toBeVisible();
      await back(page).click();
      await expect(page.getByRole('row').filter({ hasText: 'Widgets, part two' })).toHaveCount(0);
    });
  });
});
