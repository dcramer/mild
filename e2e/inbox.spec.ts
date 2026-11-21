import {
  PHONE,
  back,
  choose,
  expect,
  inboxLink,
  inboxRow,
  inboxRows,
  inboxSearch,
  mailWindow,
  param,
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

  test('lists conversations newest first, with what Sift thinks of each, and narrows by it', async ({ page }) => {
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

  test('a row’s label is changed in place: saved at once, the conversation left in the inbox, and picked again to undo', async ({ page, sift }) => {
    await page.goto('/inbox');
    const label = () => inboxRow(page, 'Your order has shipped').getByRole('combobox', { name: 'What Your order has shipped is' });
    const pick = async (name: string) => {
      await label().click();
      const saved = page.waitForResponse('**/api/feedback');
      await page.getByRole('option', { name, exact: true }).click();
      await saved;
    };
    await expect(label()).toContainText('Receipts');

    await pick('Personal');
    await expect(reader(page)).toHaveCount(0);
    await page.reload();
    await expect(label()).toContainText('Personal');
    expect(sift.google().mailbox('me@example.org').message('m3')!.labelIds).toContain('INBOX');

    await pick('Receipts');
    await page.reload();
    await expect(label()).toContainText('Receipts');
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
    await expect(inboxRow(page, 'Your order has shipped').getByRole('combobox', { name: 'What Your order has shipped is' })).toContainText('Personal');
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

  test('J and K move, O opens a conversation with its unread open, and opening it marks it read', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
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
    // Answered as Receipts, as its row says, though Sift could not place it.
    await expect(open.getByRole('combobox', { name: 'What this message is' })).toContainText('Receipts');
    // In Inbox, Sift's reason waits for Why.
    await expect(open.getByText(/^Your answer\. Sift said: /)).toHaveCount(0);
    await open.getByRole('button', { name: 'Why' }).click();
    await expect(open.getByText(/^Your answer\. Sift said: /)).toBeVisible();
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

  test('pointed at, a row puts Archive and Mark read in place of its time, which act on it alone', async ({ page }) => {
    await page.goto('/inbox');
    const row = inboxRow(page, 'Widgets, part two');
    await expect(row.getByRole('button', { name: 'Archive' })).toBeHidden();
    await expect(row.getByRole('cell').last()).toHaveText(/\d:\d\d [AP]M/);
    await pointAt(row);
    await expect(row.getByRole('cell').last().locator('time')).toBeHidden();
    await pointAt(row.getByRole('button', { name: 'Mark read' }));
    await expect(tooltip(page)).toHaveText('Mark read');
    await row.getByRole('button', { name: 'Mark read' }).click();
    await expect(row.getByRole('button', { name: 'Mark unread' })).toBeVisible();
    await expect(row).toHaveCount(1);
    await expect(reader(page)).toHaveCount(0);

    // A row whose check was pressed keeps the focus, but shows its presses no longer once the pointer moves on.
    const other = inboxRow(page, 'This week in widgets');
    await other.getByRole('checkbox').check();
    await pointAt(row);
    await expect(other.getByRole('button', { name: 'Archive' })).toBeHidden();
    await row.getByRole('button', { name: 'Archive' }).click();
    await expect(toast(page, 'Widgets, part two')).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(inboxRows(page)).toHaveCount(18);
    await page.goto('/inbox?unread=1');
    await expect(inboxRow(page, 'This week in widgets')).toBeVisible();
    await expect(inboxRow(page, 'Widgets, part two')).toHaveCount(0);
  });

  test('X selects, E archives what is selected, and Undo puts it back', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
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
