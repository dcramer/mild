import { expect, test, PHONE } from './fixture.ts';
import { boxOf, param, path, pointAt, tooltip } from './wait.ts';
import { choose, senderCard, section } from './parts.ts';
import { back, reader, readerHeading } from './reader.ts';
import { forReviewLink, inboxLink, senderPage } from './navigation.ts';
import { dismiss, putAway, failureToast, toast } from './toast.ts';
import { patchJson, forward, requestsTo } from './network.ts';
import { mailWindow, settings, settingsInbox } from './settings.ts';
import { ME } from './mailboxes.ts';
import { proposedRule, inboxRow, inboxRows, inboxSearch } from './inbox.ts';
import { ruleDialog } from './rule.ts';

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

/** Watches for a row with `subject` coming back on the page, setting `window.shownAgain`. */
const SHOWN_AGAIN = (subject: string) => `window.shownAgain = false;
new MutationObserver(() => {
  if ([...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent.includes(${JSON.stringify(subject)}))) window.shownAgain = true;
}).observe(document.body, { subtree: true, childList: true, characterData: true });`;

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

  test('opened again from the device, with more in it than a screen, on a phone’s processor, goes from loading to its rows without saying it is empty', async ({
    page,
  }) => {
    test.slow();
    // Three hundred older conversations, so the copy on the device is more than its first part.
    await patchJson(
      page,
      '**/api/sync*',
      (sync: {
        reset: boolean;
        conversations: { accountId: string; threadId: string; conversation: { threadId: string; messages: { receivedAt: number }[] } | null }[];
      }) => {
        const oldest = sync.conversations.findLast((c) => c.conversation !== null);
        if (!sync.reset || !oldest?.conversation) return sync;
        const older = Array.from({ length: 300 }, (_, i) => ({
          ...oldest,
          threadId: `older-${i}`,
          conversation: {
            ...oldest.conversation!,
            threadId: `older-${i}`,
            messages: oldest.conversation!.messages.map((m) => ({ ...m, receivedAt: m.receivedAt - (i + 1) * 3_600_000 })),
          },
        }));
        return { ...sync, conversations: [...sync.conversations, ...older] };
      },
    );
    await page.addInitScript(
      'new MutationObserver(() => { if (document.body?.textContent?.includes("Nothing is in your inbox")) window.saidEmpty = true; }).observe(document, { subtree: true, childList: true, characterData: true })',
    );
    await page.goto('/inbox');
    await expect(inboxRows(page).first()).toBeVisible();
    await page.unrouteAll();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.reload();
    // What this checks is the order, not the speed (Sentry's "Inbox rows" times it): slowed four times on CI's runner,
    // beside three other workers, the rows come at 6 to 10 s where they come at 2 s on a quiet machine.
    await expect(inboxRows(page).first()).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate<boolean>("'saidEmpty' in window")).toBe(false);
  });

  test('lists conversations newest first, with what Mild thinks of each, and narrows by it', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await expect(inboxRows(page).first()).toContainText('This week in widgets');
    // What Mild thinks is on the row's bar, drawn once the row is pointed at.
    await pointAt(inboxRows(page).first());
    await expect(inboxRows(page).first()).toContainText('Newsletters');
    await pointAt(inboxRow(page, 'Your March bill'));
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

  test('opened again, what the feed changes is not undone by the older rows read from the device after it', async ({ page }) => {
    test.slow();
    let gone = false;
    await patchJson(page, '**/api/sync*', (feed) => {
      const { conversation } = (feed.conversations.at(-1) ?? {}) as { conversation?: { accountId: string; messages: { receivedAt: number }[] } };
      if (feed.reset && conversation) {
        const more = Array.from({ length: 230 }, (_, i) => {
          const threadId = `many-${i}`;
          const messages = conversation.messages.map((m) => ({ ...m, messageId: `${threadId}-m`, receivedAt: m.receivedAt - (i + 1) * 60_000 }));
          return { accountId: conversation.accountId, threadId, conversation: { ...conversation, threadId, messages } };
        });
        return { ...feed, conversations: [...feed.conversations, ...more] };
      }
      // Opened again: one of the oldest, which the device holds past its first part, is gone.
      if (!feed.reset && gone) return feed;
      gone = true;
      return { ...feed, conversations: [...feed.conversations, { accountId: ME, threadId: 'many-200', conversation: null }] };
    });
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(100);
    await expect.poll(() => page.evaluate<number>(copied)).toBe(249);
    gone = false;
    // Its row on the device is not deleted, as when the page closes before the write lands: what the device's rest still
    // holds of it must not be put back over the feed's word. On a phone's processor the feed answers before that is read.
    await page.addInitScript(`{
      const remove = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (key) {
        return String(key).endsWith('/many-200') ? this.get(key) : remove.call(this, key);
      };
    }`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const asked = page.waitForResponse('**/api/sync*');
    await page.reload();
    await asked;
    // What this checks is which rows come, not how soon: slowed four times on CI's runner, beside three other workers,
    // each hundred takes 3 to 5 s to draw.
    const drawn = { timeout: 20_000 };
    await expect(inboxRows(page)).toHaveCount(100, drawn);
    await inboxRows(page).last().scrollIntoViewIfNeeded();
    await expect(inboxRows(page)).toHaveCount(200, drawn);
    await inboxRows(page).last().scrollIntoViewIfNeeded();
    await expect(inboxRows(page)).toHaveCount(248, drawn);
  });

  test('a row’s label does what the label does: one that keeps is saved in place, one that archives takes the conversation out of the inbox once its toast goes', async ({
    page,
    sift,
  }) => {
    const sent = requestsTo(page, '/api/feedback');
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    // On the bar the row shows while pointed at.
    const label = async () => {
      await pointAt(row);
      return row.getByRole('combobox', { name: 'What Your order has shipped is' });
    };
    const pick = async (name: string) => {
      await (await label()).click();
      await page.getByRole('option', { name, exact: true }).click();
    };
    const inGmail = () => sift.google().mailbox(ME).labelsOf('m3');
    await expect(await label()).toContainText('Receipts');

    // Personal keeps its mail: saved at once, and the row stays.
    const saved = page.waitForResponse('**/api/feedback');
    await pick('Personal');
    await saved;
    await expect(reader(page)).toHaveCount(0);
    await page.reload();
    await expect(await label()).toContainText('Personal');
    expect(inGmail()).toContain('INBOX');

    // Receipts archives: the row goes at once, and Undo puts it back with nothing sent.
    await pick('Receipts');
    await expect(toast(page, 'Your order has shipped')).toBeVisible();
    await expect(row).toHaveCount(0);
    await toast(page, 'Your order has shipped').getByRole('button', { name: 'Undo' }).click();
    await expect(await label()).toContainText('Personal');
    expect(sent()).toBe(1);

    await pick('Receipts');
    await expect(row).toHaveCount(0);
    // Mild's pass archives it after the answer is saved: the row stays gone meanwhile.
    await page.evaluate(SHOWN_AGAIN('Your order has shipped'));
    await putAway(page);
    await expect.poll(sent).toBe(2);
    await expect.poll(inGmail).not.toContain('INBOX');
    await expect(inboxRows(page)).toHaveCount(18);
    expect(await page.evaluate<boolean>('window.shownAgain')).toBe(false);
    await page.reload();
    await expect(inboxRows(page)).toHaveCount(18);
    await expect(row).toHaveCount(0);
  });

  test('a row’s label menu ends as every label menu does, Add a label… then Make a rule…, which starts the rule on its sender', async ({ page }) => {
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    await pointAt(row);
    await row.getByRole('combobox', { name: 'What Your order has shipped is' }).click();
    await expect(page.getByRole('option').nth(-2)).toHaveText('Add a label…');
    await expect(page.getByRole('option').last()).toHaveText('Make a rule…');
    await page.getByRole('option', { name: 'Make a rule…' }).click();
    await expect(ruleDialog(page)).toContainText('orders@shop.example.com');
  });

  test('a row’s label menu stays open while what Mild thinks of the row changes, and takes the pick', async ({ page }) => {
    // The page reads the reply ahead, as it would a real one: it is the order's text.
    await page.route('**/api/message**', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('id') !== 'm3-reply') return route.fallback();
      url.searchParams.set('id', 'm3');
      return route.fallback({ url: url.toString() });
    });
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    await pointAt(row);
    const label = row.getByRole('combobox', { name: 'What Your order has shipped is' });
    await label.click();
    await expect(page.getByRole('option', { name: 'Receipts', exact: true })).toBeVisible();
    // Said in another tab: the feed brings it to this row while its menu is open.
    await page.evaluate(
      `fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sift': '1' }, body: JSON.stringify({ accountId: '${ME}', sender: 'orders@shop.example.com', label: 'personal', messageId: 'm3', carryOut: false }) })`,
    );
    // Coming back to the tab asks Mild what changed.
    await putAway(page);
    await expect(label).toContainText('Personal');
    await page.getByRole('option', { name: 'Receipts', exact: true }).click();
    await expect(toast(page, 'Your order has shipped')).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test('opened again, draws the rule Mild proposes with its rows, from the device, so no row moves when Mild answers', async ({ page }) => {
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    const proposed = proposedRule(page, 'Keep Receipts from billing@utility.example.net?');
    await expect(proposed).toBeVisible();
    const where = await boxOf(row);
    const waiting: (() => void)[] = [];
    await page.route('**/api/suggestions*', (route) => void waiting.push(() => void route.continue()));
    await page.reload();
    await expect(row).toBeVisible();
    await expect(proposed).toBeVisible();
    expect((await boxOf(row)).y).toBe(where.y);
    await expect.poll(() => waiting.length).toBeGreaterThan(0);
    for (const go of waiting) go();
  });

  test('Archive on a row says it is what its label says, and does what the label does', async ({ page, sift }) => {
    const gmail = () => sift.google().mailbox(ME);
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    await pointAt(row);
    await expect(row.getByRole('combobox', { name: 'What Your order has shipped is' })).toContainText('Receipts');
    await row.getByRole('button', { name: 'Archive' }).click();
    await expect(row).toHaveCount(0);
    // Its toast says so: archived, to the label.
    await expect(toast(page, 'Your order has shipped')).toContainText(/Archived\s*to\s*Receipts/);
    await dismiss(page, 'Your order has shipped');
    await expect.poll(() => gmail().labelsOf('m3')).not.toContain('INBOX');
    expect(gmail().labelsOf('m3')).toContain(gmail().labelId('mild/receipts'));
    await page.reload();
    await expect(inboxRows(page)).toHaveCount(18);
    await expect(row).toHaveCount(0);
  });

  test('Archive on a row whose label Mild is not sure of still gives that label, and its toast says so', async ({ page, sift }) => {
    const gmail = () => sift.google().mailbox(ME);
    // Mild's answer about the shipping note, but unsure: it asks rather than archiving it itself.
    await patchJson(page, '**/api/sync*', (feed) => ({
      ...feed,
      conversations: feed.conversations.map((c: { conversation: { thinks: object | null; messages: { messageId: string }[] } | null }) =>
        c.conversation?.messages.some((m) => m.messageId === 'm3')
          ? { ...c, conversation: { ...c.conversation, thinks: { ...c.conversation.thinks, disposition: 'review', confidence: 0.5 } } }
          : c,
      ),
    }));
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    await pointAt(row);
    await expect(row.getByRole('combobox', { name: 'What Your order has shipped is' })).toContainText('Receipts');
    await row.getByRole('button', { name: 'Archive' }).click();
    await expect(toast(page, 'Your order has shipped')).toContainText(/Archived\s*to\s*Receipts/);
    await dismiss(page, 'Your order has shipped');
    await expect.poll(() => gmail().labelsOf('m3')).toContain(gmail().labelId('mild/receipts'));
  });

  test('a row’s label menu stays under its label while the pointer moves into it', async ({ page }) => {
    // The page reads the reply ahead, as it would a real one: it is the order's text.
    await page.route('**/api/message**', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('id') !== 'm3-reply') return route.fallback();
      url.searchParams.set('id', 'm3');
      return route.fallback({ url: url.toString() });
    });
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    await pointAt(row);
    const label = row.getByRole('combobox', { name: 'What Your order has shipped is' });
    await label.click();
    const under = await boxOf(label);
    await pointAt(page.getByRole('option', { name: 'Personal', exact: true }));
    await expect(label).toBeVisible();
    const list = await boxOf(page.getByRole('listbox'));
    expect(list.y).toBeGreaterThanOrEqual(under.y + under.height);
    expect(list.x).toBeGreaterThanOrEqual(under.x);
    expect(list.x).toBeLessThan(under.x + under.width);
  });

  test('a row’s label answers for the newest message still in the inbox, not a newer one that has left it', async ({ page }) => {
    type Copied = { messages: { messageId: string; receivedAt: number; labelIds: string[] }[] };
    // A reply that has left the inbox, after the order that keeps the conversation there.
    await patchJson(page, '**/api/sync*', (sync: { conversations: { conversation: Copied | null }[] }) => ({
      ...sync,
      conversations: sync.conversations.map((c) => {
        const order = c.conversation?.messages.find((m) => m.messageId === 'm3');
        if (!c.conversation || !order) return c;
        return {
          ...c,
          conversation: {
            ...c.conversation,
            messages: [...c.conversation.messages, { ...order, messageId: 'm3-reply', receivedAt: order.receivedAt + 60_000, labelIds: [] }],
          },
        };
      }),
    }));
    // The page reads the reply ahead, as it would a real one: it is the order's text.
    await page.route('**/api/message**', (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('id') !== 'm3-reply') return route.fallback();
      url.searchParams.set('id', 'm3');
      return route.fallback({ url: url.toString() });
    });
    await page.goto('/inbox');
    const row = inboxRow(page, 'Your order has shipped');
    await pointAt(row);
    const label = row.getByRole('combobox', { name: 'What Your order has shipped is' });
    await expect(label).toContainText('Receipts');
    const saved = page.waitForRequest('**/api/feedback');
    await label.click();
    await page.getByRole('option', { name: 'Personal', exact: true }).click();
    expect((await saved).postDataJSON()).toMatchObject({ messageId: 'm3', label: 'personal' });
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

  test('a conversation archived stays gone once the feed has it, and the copy and its key go at sign-out', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await pointAt(inboxRow(page, 'This week in widgets'));
    await inboxRow(page, 'This week in widgets').getByRole('button', { name: 'Archive' }).click();
    await expect(inboxRows(page)).toHaveCount(18);
    await dismiss(page, 'This week in widgets');
    await expect.poll(() => page.evaluate<number>(copied)).toBe(18);
    await page.reload();
    await expect(inboxRows(page)).toHaveCount(18);

    await page.getByRole('button', { name: /^Account, / }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: /^Account, / })).toHaveCount(0);
    await expect.poll(() => page.evaluate<string[]>(databases)).not.toContain('sift-copy');
    await expect.poll(() => page.evaluate<string[]>(databases)).not.toContain('sift-device');
  });

  test('a name in a row opens their card on hover, and a press on it opens the conversation', async ({ page }) => {
    await page.goto('/inbox');
    const lunch = inboxRow(page, 'Lunch on Thursday?');
    await pointAt(lunch.getByText('Ada Lovelace').filter({ visible: true }));
    const card = senderCard(page, 'Ada Lovelace');
    await expect(card).toContainText('ada@example.org');
    await expect(card.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', senderPage('ada@example.org'));

    await lunch.getByText('Ada Lovelace').filter({ visible: true }).click();
    await expect(readerHeading(page, 'Lunch on Thursday?')).toBeVisible();
  });

  test('is the section For review was: / opens it, and its icon carries how many conversations are unread, changed as a press is made', async ({ page }) => {
    await page.goto('/');
    await path(page).toBe('/inbox');
    await expect(forReviewLink(page)).toHaveCount(0);
    await page.goto('/inbox?unread=1');
    await expect(inboxRows(page).first()).toBeVisible();
    const unread = await inboxRows(page).count();
    await expect(inboxLink(page)).toHaveAccessibleName(`Inbox ${unread}`);

    // Never answered, so the count can only be following the press.
    const read = page.waitForRequest('**/api/mail/change');
    await page.route('**/api/mail/change', () => {});
    await page.goto('/inbox');
    await inboxRow(page, 'This week in widgets').getByRole('checkbox').check();
    await page.getByRole('toolbar', { name: 'Selected rows' }).getByRole('button', { name: 'Mark read' }).click();
    await read;
    await expect(inboxLink(page)).toHaveAccessibleName(`Inbox ${unread - 1}`);
    const widgets = inboxRow(page, 'Widgets, part two');
    await pointAt(widgets);
    await widgets.getByRole('button', { name: 'Archive' }).click();
    await expect(inboxLink(page)).toHaveAccessibleName(`Inbox ${unread - 2}`);
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

  test('Spam is sent to Gmail once its toast goes, and Undo before then sends nothing', async ({ page, sift }) => {
    const changes = requestsTo(page, '/api/mail/change');
    await page.goto('/inbox');
    const deal = inboxRow(page, '48 hours only: 30% off');
    const id = (await deal.getAttribute('data-holds'))!.split('/')[1]!;
    await pointAt(deal);
    await deal.getByRole('button', { name: 'Spam' }).click();
    await expect(deal).toHaveCount(0);
    await toast(page, '48 hours only: 30% off').getByRole('button', { name: /^Undo/ }).click();
    await expect(deal).toBeVisible();
    expect(changes()).toBe(0);
    expect(sift.google().mailbox(ME).labelsOf(id)).toContain('INBOX');

    await pointAt(deal);
    await deal.getByRole('button', { name: 'Spam' }).click();
    await dismiss(page, '48 hours only: 30% off');
    await expect.poll(() => sift.google().mailbox(ME).labelsOf(id)).toContain('SPAM');
    expect(sift.google().mailbox(ME).labelsOf(id)).not.toContain('INBOX');
    await expect(deal).toHaveCount(0);
  });

  test('an archive is said at once, whatever Gmail, the copy or a press on another conversation is waiting on', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    await page.route('**/api/sync**', () => {});
    await page.route('**/api/mail/change', () => {});
    for (const subject of ['This week in widgets', 'Widgets, part two']) {
      await pointAt(inboxRow(page, subject));
      await inboxRow(page, subject).getByRole('button', { name: 'Archive' }).click();
      await expect(toast(page, subject)).toBeVisible();
      await expect(inboxRow(page, subject)).toHaveCount(0);
    }
  });

  test.describe('refused', () => {
    test.use({ allow: ['status of 400'] });

    test('an archive Mild refuses puts the conversation back and says so', async ({ page }) => {
      await page.route('**/api/mail/change', (route) => route.fulfill({ status: 400, json: { error: 'That mailbox is not yours.' } }));
      await page.goto('/inbox');
      const widgets = inboxRow(page, 'This week in widgets');
      await pointAt(widgets);
      await widgets.getByRole('button', { name: 'Archive' }).click();
      await expect(widgets).toHaveCount(0);
      await dismiss(page, 'This week in widgets');
      await expect(failureToast(page, 'Could not archive it')).toContainText('That mailbox is not yours.');
      await expect(widgets).toBeVisible();
    });
  });

  test.describe('busy', () => {
    test.use({ allow: ['status of 503'] });

    test('an archive Mild could not take for now is sent again, and the conversation stays archived', async ({ page, sift }) => {
      let refused = 0;
      await page.route('**/api/mail/change', async (route) => {
        if (refused++ === 0) return await route.fulfill({ status: 503, json: { error: 'Busy.' } });
        await route.continue();
      });
      await page.goto('/inbox');
      const widgets = inboxRow(page, 'This week in widgets');
      const id = (await widgets.getAttribute('data-holds'))!.split('/')[1]!;
      await pointAt(widgets);
      await widgets.getByRole('button', { name: 'Archive' }).click();
      await dismiss(page, 'This week in widgets');
      await expect.poll(() => sift.google().mailbox(ME).labelsOf(id)).not.toContain('INBOX');
      expect(refused).toBe(2);
      await expect(widgets).toHaveCount(0);
      await expect(failureToast(page, 'Could not archive it')).toHaveCount(0);
    });
  });

  test.describe('without a network', () => {
    test.use({ allow: ['ERR_INTERNET_DISCONNECTED', 'net::ERR_FAILED'] });

    test('an archive made offline is shown, counted as waiting, and sent once the network is back', async ({ page, context, sift }) => {
      await page.goto('/inbox');
      const widgets = inboxRow(page, 'This week in widgets');
      const id = (await widgets.getAttribute('data-holds'))!.split('/')[1]!;
      await context.setOffline(true);
      await pointAt(widgets);
      await widgets.getByRole('button', { name: 'Archive' }).click();
      await dismiss(page, 'This week in widgets');
      await expect(page.getByRole('status').filter({ hasText: 'Mild cannot be reached: 1 change will go once it is back' })).toBeVisible();
      await expect(widgets).toHaveCount(0);
      expect(sift.google().mailbox(ME).labelsOf(id)).toContain('INBOX');

      await context.setOffline(false);
      await expect.poll(() => sift.google().mailbox(ME).labelsOf(id)).not.toContain('INBOX');
      await expect(widgets).toHaveCount(0);
      await expect(failureToast(page, 'Could not archive it')).toHaveCount(0);
    });

    test('an archive that could not reach Mild is sent the next time the page opens', async ({ page, sift }) => {
      await page.goto('/inbox');
      const widgets = inboxRow(page, 'This week in widgets');
      const id = (await widgets.getAttribute('data-holds'))!.split('/')[1]!;
      await page.route('**/api/mail/change', (route) => route.abort('failed'));
      await pointAt(widgets);
      await widgets.getByRole('button', { name: 'Archive' }).click();
      await dismiss(page, 'This week in widgets');
      await expect(page.getByRole('status').filter({ hasText: '1 change will go once it is back' })).toBeVisible();

      await page.unrouteAll();
      await page.reload();
      await expect(inboxRows(page).first()).toBeVisible();
      await expect(widgets).toHaveCount(0);
      await expect.poll(() => sift.google().mailbox(ME).labelsOf(id)).not.toContain('INBOX');
    });
  });

  test('a press in one tab shows in another at once, and its Undo there too', async ({ page, context }) => {
    await page.goto('/inbox');
    const other = await context.newPage();
    await other.goto('/inbox');
    await expect(inboxRow(other, 'This week in widgets')).toBeVisible();
    const widgets = inboxRow(page, 'This week in widgets');
    await pointAt(widgets);
    await widgets.getByRole('button', { name: 'Archive' }).click();
    await expect(inboxRow(other, 'This week in widgets')).toHaveCount(0);
    await toast(page, 'This week in widgets').getByRole('button', { name: /^Undo/ }).click();
    await expect(widgets).toBeVisible();
    await expect(inboxRow(other, 'This week in widgets')).toBeVisible();
    await other.close();
  });

  test('a tab handed the whole copy while it reads its disk draws it, without waiting on its own ask', async ({ page, context }) => {
    // The first tab keeps nothing, so the second finds no copy on the disk; what the second asks the feed itself is never answered.
    await page.addInitScript(`{
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (mode === 'readwrite' && [].concat(stores).includes('standing')) throw new DOMException('Kept nothing.', 'InvalidStateError');
        return transaction.call(this, stores, mode, ...rest);
      };
    }`);
    const other = await context.newPage();
    await other.route('**/api/sync*', () => {});
    // The second tab reads its disk only once the first tab's whole copy has reached it: its key is left to the server,
    // which answers once the copy is handed over.
    let handOver = () => {};
    const handed = new Promise<void>((done) => (handOver = done));
    await other.exposeFunction('handed', () => handOver());
    await other.addInitScript(`{
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (query) {
        return get.call(this, this.name === 'key' && query === 'key' ? 'none' : query);
      };
      new BroadcastChannel('sift-copy').addEventListener('message', ({ data }) => data !== 'ask' && window.handed());
    }`);
    let listen = () => {};
    const listening = new Promise<void>((done) => (listen = done));
    await other.route('**/api/device*', async (route) => {
      listen();
      await handed;
      await route.continue();
    });
    await page.route('**/api/sync*', async (route) => {
      await listening;
      await route.continue();
    });
    await page.goto('/inbox');
    await other.goto('/inbox');
    await expect(inboxRow(page, 'This week in widgets')).toBeVisible();
    await expect(inboxRow(other, 'This week in widgets')).toBeVisible();
    await other.close();
  });

  test('a digest Mild put in the inbox opens as what it lists, the picks first with why, each opening in the reader', async ({ page }) => {
    await page.goto('/inbox');
    const idOf = async (subject: string) => (await inboxRow(page, subject).getAttribute('data-holds'))!.split('/')[1]!;
    const [digest, order, lunch] = [await idOf('This week in widgets'), await idOf('Your order has shipped'), await idOf('Lunch on Thursday?')];
    const listed = (messageId: string, subject: string, from: { address: string; name: string }) => ({
      accountId: ME,
      messageId,
      from,
      subject,
      receivedAt: Date.now() - 3_600_000,
      archivedAt: Date.now() - 3_000_000,
    });
    await patchJson(page, '**/api/message?*', (message: { messageId: string }) =>
      message.messageId === digest
        ? {
            ...message,
            digest: {
              labelId: 'notification',
              labelName: 'Notifications',
              since: 0,
              until: 1,
              picks: [{ messageId: order, why: 'It says when the parcel comes.' }],
              mail: [
                listed(order, 'Your order has shipped', { address: 'orders@shop.example.com', name: 'Shop' }),
                listed(lunch, 'Lunch on Thursday?', { address: 'ada@example.org', name: 'Ada Lovelace' }),
              ],
            },
          }
        : message,
    );
    await inboxRow(page, 'This week in widgets').getByRole('cell').nth(2).click();
    const worth = section(page, 'Worth a look');
    await expect(worth.getByRole('row').filter({ hasText: 'Your order has shipped' })).toContainText('It says when the parcel comes.');
    const archived = section(page, 'Archived as Notifications');
    await expect(archived.getByRole('row').filter({ hasText: 'Lunch on Thursday?' })).toBeVisible();
    await expect(page.getByText('Five stories about widgets.').filter({ visible: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'What this message is' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);

    await archived.getByRole('row').filter({ hasText: 'Lunch on Thursday?' }).getByRole('cell').nth(1).click();
    await expect(readerHeading(page, 'Lunch on Thursday?')).toBeVisible();
    await back(page).click();
    await expect(section(page, 'Worth a look')).toBeVisible();
  });

  test('an archive still held when the page is left is sent', async ({ page, sift }) => {
    await page.goto('/inbox');
    const widgets = inboxRow(page, 'Widgets, part two');
    const id = (await widgets.getAttribute('data-holds'))!.split('/')[1]!;
    await pointAt(widgets);
    await widgets.getByRole('button', { name: 'Archive' }).click();
    await expect(toast(page, 'Widgets, part two')).toBeVisible();
    await page.goto('/inbox?unread=1');
    await expect.poll(() => sift.google().mailbox(ME).labelsOf(id)).not.toContain('INBOX');
  });

  test('Block sender gives them Blocked and marks their conversation spam, with one Undo', async ({ page, sift }) => {
    await page.goto('/inbox');
    const sale = inboxRow(page, 'Winter sale starts now');
    const id = (await sale.getAttribute('data-holds'))!.split('/')[1]!;
    await pointAt(sale);
    await sale.getByRole('button', { name: 'Block sender' }).click();
    await expect(sale).toHaveCount(0);
    const blocked = toast(page, 'Winter sale starts now');
    await expect(blocked).toContainText('Blocked sale@store.example.com');
    await blocked.getByRole('button', { name: /^Undo/ }).click();
    await expect(sale).toBeVisible();
    expect(sift.google().mailbox(ME).labelsOf(id)).not.toContain('SPAM');
    await page.goto('/sender/sale%40store.example.com');
    await expect(page.getByRole('button', { name: 'Block', pressed: true })).toHaveCount(0);

    await page.goto('/inbox');
    await pointAt(sale);
    await sale.getByRole('button', { name: 'Block sender' }).click();
    await dismiss(page, 'Winter sale starts now');
    await expect.poll(() => sift.google().mailbox(ME).labelsOf(id)).toContain('SPAM');
    await page.goto('/sender/sale%40store.example.com');
    await expect(page.getByRole('button', { name: 'Block', pressed: true })).toBeVisible();
  });

  test('a conversation at the top of the inbox opens whole on its first draw, its text read ahead in one call', async ({ page }) => {
    const ahead = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/messages');
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    expect((await ahead).status()).toBe(200);
    // One opened and closed first, so the reader's code is here however busy the machine: it is loaded as the page starts.
    await inboxRow(page, 'This week in widgets').getByRole('cell').nth(2).click();
    await expect(reader(page).getByText('Five stories about widgets.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reader(page)).toHaveCount(0);
    await page.evaluate(
      `window.drewLoading = false; new MutationObserver(() => { if (document.querySelector('[aria-label="Loading"]')) window.drewLoading = true; }).observe(document.body, { subtree: true, childList: true })`,
    );
    await inboxRow(page, 'Lunch on Thursday?').getByRole('cell').nth(2).click();
    await expect(reader(page).getByText('Are you free for lunch on Thursday?')).toBeVisible();
    expect(await page.evaluate('window.drewLoading')).toBe(false);
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
    // A label, in a toolbar of icons, by its tag.
    await expect(open.getByRole('combobox', { name: 'What this message is' }).locator('svg.lucide-tag')).toBeVisible();
    // In Inbox, Mild's reason waits for Why, in a card over the page rather than in the mail, and Escape puts the card away.
    await expect(open.getByText(/^Your answer\. Mild said: /)).toHaveCount(0);
    await open.getByRole('button', { name: 'Why' }).click();
    const why = page.getByRole('dialog').filter({ hasText: /^Your answer\. Mild said: / });
    await expect(why).toBeVisible();
    expect((await boxOf(open.getByRole('combobox', { name: 'What this message is' }))).y).toBeLessThan(
      (await boxOf(open.getByRole('heading', { level: 1 }))).y,
    );
    await page.keyboard.press('Escape');
    await expect(why).toHaveCount(0);
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

  test('in the reader Shift+E archives the conversation and goes back to the list, on the row that took its place, and Shift+U marks it unread and closes it', async ({
    page,
  }) => {
    await page.goto('/inbox');
    await inboxRow(page, 'This week in widgets').getByRole('cell').nth(2).click();
    const open = reader(page);
    await expect(open.getByRole('button', { name: /^Archive/ })).toBeEnabled();
    await page.keyboard.press('Shift+E');
    await expect(toast(page, 'This week in widgets')).toBeVisible();
    await expect(open).toHaveCount(0);
    await expect(inboxRow(page, 'This week in widgets')).toHaveCount(0);
    await expect(inboxRow(page, 'Widgets, part two')).toBeFocused();
    await inboxRow(page, 'Widgets, part two').getByRole('cell').nth(2).click();
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
    await dismiss(page, 'Widgets, part two');

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

  test('X selects, Shift+E archives what is selected, a lone E does nothing, and Undo puts it back', async ({ page }) => {
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
    await expect(inboxRows(page)).toHaveCount(19);
    await expect(bar).toContainText('2 selected');
    await page.keyboard.press('Shift+E');
    // The press and how many, not a chip for each label they had.
    await expect(toast(page, '2 conversations')).toHaveAccessibleDescription('Archived 2 conversations');
    await expect(inboxRows(page)).toHaveCount(17);
    await expect(inboxRow(page, 'This week in widgets')).toHaveCount(0);
    await expect(bar).toHaveCount(0);

    await page.keyboard.press('z');
    await expect(inboxRows(page)).toHaveCount(19);
    await expect(inboxRow(page, 'This week in widgets')).toBeVisible();
  });

  test('the check at the start of the bar selects every row and lets them all go, and Mark unread is in its More menu', async ({ page }) => {
    await page.goto('/inbox');
    await expect(inboxRows(page)).toHaveCount(19);
    const checks = page.getByRole('checkbox', { name: /^Select (?!all$)/ });
    const total = await checks.count();
    await checks.first().check();
    const bar = page.getByRole('toolbar', { name: 'Selected rows' });
    await expect(bar).toContainText('1 selected');
    await expect(bar.getByRole('button', { name: 'Mark unread' })).toHaveCount(0);

    const all = bar.getByRole('checkbox', { name: 'Select all' });
    await all.check();
    await expect(bar).toContainText(`${total} selected`);
    for (const check of await checks.all()) await expect(check).toBeChecked();

    const unread = page.waitForResponse('**/api/mail/change');
    await bar.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Mark unread' }).click();
    await unread;
    await expect(bar).toHaveCount(0);
    await page.goto('/inbox?unread=1');
    await expect(checks).toHaveCount(total);

    await checks.first().check();
    await all.check();
    // The bar goes with the last row, so there is no check left to see unchecked.
    await all.click();
    await expect(bar).toHaveCount(0);
  });

  test('when Gmail takes only some of what is selected, the page says the rest failed once it is sent', async ({ page }) => {
    await page.route('**/api/mail/change', async (route) => {
      const reply = (await (await forward(route)).json()) as { actions: number[] };
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
    await page.keyboard.press('Shift+E');
    await dismiss(page, '2 conversations');
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
    await dismiss(page, 'Your order has shipped');
    await page.keyboard.press('Escape');
    await expect(inboxRows(page)).toHaveCount(18);

    await inboxSearch(page).fill('1042');
    await expect(inboxRows(page)).toHaveCount(1);
    await expect(inboxRow(page, 'Your order has shipped')).toContainText('Archived');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE });

    test('reads as a mail app, with no label on the row, and archiving from the reader goes back to the list', async ({ page }) => {
      await page.goto('/inbox');
      const widgets = page.getByRole('row').filter({ hasText: 'Widgets, part two' });
      await expect(widgets).toContainText('Weekly Digest');
      await expect(widgets).not.toContainText('Newsletters');
      await widgets.click();
      const open = reader(page);
      await expect(open.getByRole('heading', { name: 'Widgets, part two', level: 1 })).toBeVisible();
      await open.getByRole('button', { name: 'Archive', exact: true }).click();
      await expect(toast(page, 'Widgets, part two')).toBeVisible();
      await expect(open).toHaveCount(0);
      await expect(page.getByRole('row').filter({ hasText: 'Widgets, part two' })).toHaveCount(0);
    });
  });
});
