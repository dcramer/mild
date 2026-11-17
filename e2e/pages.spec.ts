import type { Page } from '@playwright/test';
import { ruleToast } from './rule.ts';
import { expect, panel, row, test } from './sift.ts';

const SENDER = '/sender/me%40example.org/notifications%40code.example.com';
const DOMAIN = '/domain/me%40example.org/code.example.com';

/** The rows of the page's lists that hold mail, not the day headings between them. */
const rows = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('cell') });

const search = (page: Page) => new URL(page.url()).searchParams;

/** One of a sender's or domain's standings; `aria-pressed` says whether it is theirs. */
const standing = (page: Page, name: string) => page.getByRole('group', { name: /stands$/ }).getByRole('button', { name, exact: true });

test.describe('Activity, after a pass with Sift on', () => {
  test.use({ variant: 'on' });

  test('mail Sift could not place says it asked you, and an undone change is struck through', async ({ page }) => {
    await page.goto('/activity');
    await expect(page.getByRole('radio', { name: 'Changed' })).toBeChecked();
    await expect(row(page, 'Quick question')).toContainText('Asked you');
    await expect(row(page, 'Quick question')).not.toContainText('Unlabelled');
    await expect(row(page, 'Last day of the sale').getByText('Archived', { exact: true }).filter({ visible: true })).toHaveCSS(
      'text-decoration-line',
      'line-through',
    );
  });
});

test.describe('Activity', () => {
  test('lists nothing changed while Sift is off, and every decision under Everything', async ({ page }) => {
    await page.goto('/activity');
    await expect(page.getByRole('radio', { name: 'Changed' })).toBeChecked();
    await expect(page.getByText('Sift has changed nothing in Gmail in this period.')).toBeVisible();

    await page.getByRole('radio', { name: 'Everything' }).click();
    expect(search(page).get('show')).toBe('all');
    await expect(rows(page)).toHaveCount(21);
    await expect(page.getByRole('columnheader', { name: 'Today' })).toBeVisible();
    await expect(row(page, 'Winter sale starts now')).toContainText('Would archive');
    await expect(row(page, 'Winter sale starts now')).toContainText('Marketing');
    await expect(row(page, 'Lunch on Thursday?')).toContainText('Would ask you');
  });

  test('search narrows by subject and by sender, and is kept in the address', async ({ page }) => {
    await page.goto('/activity?show=all');
    await expect(rows(page)).toHaveCount(21);
    await page.getByRole('searchbox', { name: 'Search subject or sender' }).fill('widgets');
    await expect(rows(page)).toHaveCount(2);
    expect(search(page).get('q')).toBe('widgets');

    await page.getByRole('searchbox', { name: 'Search subject or sender' }).fill('ops.example.com');
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, 'Replica lag on db-3')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search subject or sender' }).fill('nothing like this');
    await expect(page.getByText('Nothing matches.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search subject or sender' })).toHaveValue('nothing like this');
    await expect(page.getByText('Nothing matches.')).toBeVisible();
  });

  test('the period is kept in the address', async ({ page }) => {
    await page.goto('/activity?show=all');
    await page.getByRole('combobox', { name: 'Period' }).click();
    await page.getByRole('option', { name: 'Last 30 days' }).click();
    await expect(page.getByRole('combobox', { name: 'Period' })).toContainText('Last 30 days');
    expect(search(page).get('days')).toBe('30');
    await expect(rows(page)).toHaveCount(21);

    await page.getByRole('combobox', { name: 'Period' }).click();
    await page.getByRole('option', { name: 'Last 7 days' }).click();
    expect(search(page).has('days')).toBe(false);
  });

  test('narrowed to mail with a one-click unsubscribe, only the three lists are left', async ({ page }) => {
    await page.goto('/activity?show=all');
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('radio', { name: 'Has a one-click unsubscribe' }).click();
    await expect(rows(page)).toHaveCount(4);
    for (const subject of ['This week in widgets', 'Widgets, part two', '48 hours only: 30% off', 'Winter sale starts now'])
      await expect(row(page, subject)).toBeVisible();
    expect(search(page).get('fact')).toBe('one-click');
  });

  test('a row opens its message, Next steps down the list, and Close returns to the list as it was', async ({ page }) => {
    await page.goto('/activity?show=all');
    await page.getByRole('cell', { name: 'Winter sale starts now' }).click();
    const open = panel(page);
    await expect(open.getByRole('heading', { name: 'Winter sale starts now' })).toBeVisible();
    expect(search(page).get('message')).toBe('m8');
    expect(search(page).get('show')).toBe('all');
    await expect(open).toContainText('of 21');

    await open.getByRole('button', { name: 'J Next' }).click();
    await expect(open.getByRole('heading', { name: 'Notes from the review' })).toBeVisible();
    expect(search(page).get('message')).toBe('m7');

    await open.getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(page.url()).toMatch(/\/activity\?show=all$/);
    await expect(rows(page)).toHaveCount(21);
  });

  test('Back closes a message opened from the list', async ({ page }) => {
    await page.goto('/activity?show=all');
    await page.getByRole('cell', { name: 'Lunch on Thursday?' }).click();
    await expect(panel(page).getByRole('heading', { name: 'Lunch on Thursday?' })).toBeVisible();
    await page.goBack();
    await expect(panel(page)).toHaveCount(0);
    expect(page.url()).toMatch(/\/activity\?show=all$/);
  });

  test('a message opened by its address on Activity closes to Activity alone', async ({ page }) => {
    await page.goto('/activity?message=m6&account=me%40example.org');
    await expect(panel(page).getByRole('heading', { name: 'Lunch on Thursday?' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/activity');
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  });

  test('the page of a long list is in the address, and narrowing the list goes back to its first', async ({ page }) => {
    // The seed has 21 decisions, under one page; the server says there are more.
    await page.route('**/api/decisions?**', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), total: 120 } });
    });
    await page.goto('/activity?show=all');
    await expect(page.getByText('1–50 of 120')).toBeVisible();
    await page.getByRole('button', { name: 'Older' }).click();
    await expect(page.getByText('51–100 of 120')).toBeVisible();
    expect(search(page).get('page')).toBe('2');

    await page.reload();
    await expect(page.getByText('51–100 of 120')).toBeVisible();

    await page.getByRole('radio', { name: 'Changed' }).click();
    await expect(page.getByText('1–50 of 120')).toBeVisible();
    expect(search(page).get('page')).toBeNull();
    // A list still loading when the test ends would find its reply gone.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('A sender', () => {
  test('with several names lists each, with what its mail is, and no standing', async ({ page }) => {
    await page.goto(SENDER);
    await expect(page.getByRole('heading', { name: 'notifications@code.example.com', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Answer 8 waiting' })).toBeVisible();

    const names = page.getByRole('table').first();
    await expect(rows(page).filter({ has: page.getByRole('button', { name: 'Make a rule…' }) })).toHaveCount(4);
    await expect(names.getByRole('row', { name: /^Dependabot 3 · 38%/ })).toContainText('Notifications');
    await expect(names.getByRole('row', { name: /^Security alerts 2 · 25%/ })).toContainText('Account alerts');
    await expect(names.getByRole('row', { name: /^github-actions\[bot\] 2 · 25%/ })).toContainText('Notifications');
    await expect(names.getByRole('row', { name: /^Ada Lovelace 1 · 13%/ })).toContainText('Unlabelled');

    for (const name of ['Trust', 'Unwanted', 'Block']) await expect(standing(page, name)).toHaveAttribute('aria-pressed', 'false');
  });

  test('From narrows their mail to one name, and is kept in the address', async ({ page }) => {
    await page.goto(SENDER);
    const mail = page.getByRole('table').nth(1);
    await expect(mail.getByRole('row').filter({ has: page.getByRole('cell') })).toHaveCount(8);
    await page.getByRole('combobox', { name: 'From' }).click();
    await page.getByRole('option', { name: 'Dependabot' }).click();
    await expect(mail.getByRole('row').filter({ has: page.getByRole('cell') })).toHaveCount(3);
    expect(search(page).get('name')).toBe('Dependabot');
  });

  test("a toast is a slip in the bottom right: its words, then its presses under them, above a panel's footer", async ({ page }) => {
    await page.goto(SENDER);
    await standing(page, 'Block').click();
    const said = ruleToast(page, 'Mail from notifications@code.example.com: send it to spam');
    const box = (await said.boundingBox())!;
    const words = (await said.getByText('Mail from notifications@code.example.com: send it to spam', { exact: true }).boundingBox())!;
    const undo = (await said.getByRole('button', { name: 'Undo' }).boundingBox())!;
    const { width, height } = page.viewportSize()!;
    expect(undo.y).toBeGreaterThanOrEqual(words.y + words.height);
    expect(box.x + box.width).toBeGreaterThan(width - 40);
    expect(height - (box.y + box.height)).toBeGreaterThanOrEqual(60);
  });

  test('Unwanted is on in one press, with the rule said in its toast and nothing opened over their page', async ({ page }) => {
    await page.goto(SENDER);
    await standing(page, 'Unwanted').click();
    await expect(ruleToast(page, 'Mail from notifications@code.example.com: archive it')).toContainText('Rule added');
    await expect(standing(page, 'Unwanted')).toHaveAttribute('aria-pressed', 'true');
    await expect(standing(page, 'Trust')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('dialog', { name: 'Add a rule' })).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });

  test('a message opened from their mail closes back to their page', async ({ page }) => {
    await page.goto(SENDER);
    await page.getByRole('cell', { name: 'Bump zod from 4.0.0 to 4.0.2' }).click();
    await expect(panel(page).getByRole('heading', { name: 'Bump zod from 4.0.0 to 4.0.2' })).toBeVisible();
    expect(search(page).get('account')).toBe('me@example.org');

    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(SENDER);
    expect(new URL(page.url()).search).toBe('');
  });

  test('Answer 8 waiting steps through what waits on the reader', async ({ page }) => {
    await page.goto(SENDER);
    await page.getByRole('button', { name: 'Answer 8 waiting' }).click();
    await expect(panel(page)).toContainText('1 of 8');
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });

  test('their domain is a link to the domain page', async ({ page }) => {
    await page.goto(SENDER);
    await page.getByRole('link', { name: 'code.example.com' }).click();
    await expect(page.getByRole('heading', { name: 'code.example.com', level: 1 })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(DOMAIN);
  });

  test('All their mail, in a message opened from For review, goes to the sender, and Back returns to the message', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Lunch on Thursday?' }).click();
    await expect(panel(page).getByRole('heading', { name: 'Lunch on Thursday?' })).toBeVisible();
    await panel(page).getByRole('link', { name: 'All their mail' }).click();
    await expect(page.getByRole('heading', { name: 'Ada Lovelace', level: 1 })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/sender/me%40example.org/ada%40example.org');
    expect(new URL(page.url()).search).toBe('');

    await page.goBack();
    await expect(panel(page).getByRole('heading', { name: 'Lunch on Thursday?' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).search).toBe('');
  });
});

test.describe('Who sent it is a link wherever it is named', () => {
  test("a name goes to the sender's mail under that name, and the address under it to all of it", async ({ page }) => {
    await page.goto('/');
    const sent = page.getByRole('row').filter({ hasText: 'Re: Fix the release script' });
    await sent.getByRole('link', { name: 'Ada Lovelace' }).click();
    await expect(page.getByRole('heading', { name: 'notifications@code.example.com', level: 1 })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'From' })).toContainText('Ada Lovelace');
    await expect(
      page
        .getByRole('table')
        .nth(1)
        .getByRole('row')
        .filter({ has: page.getByRole('cell') }),
    ).toHaveCount(1);
    await expect(panel(page)).toHaveCount(0);

    await page.goBack();
    await sent.getByRole('link', { name: 'notifications@code.example.com' }).click();
    await expect(page.getByRole('combobox', { name: 'From' })).toContainText('Every name');
    expect(new URL(page.url()).pathname).toBe(SENDER);
  });

  test("a name on its sender's page narrows their mail to it", async ({ page }) => {
    await page.goto(SENDER);
    await page.getByRole('table').first().getByRole('link', { name: 'Dependabot' }).click();
    await expect(page.getByRole('combobox', { name: 'From' })).toContainText('Dependabot');
    expect(search(page).get('name')).toBe('Dependabot');
  });

  test('a name an address writes under alone does not narrow its page', async ({ page }) => {
    await page.goto('/sender/me%40example.org/ada%40example.org?name=Someone');
    await expect(page.getByRole('heading', { name: 'Ada Lovelace', level: 1 })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Lunch on Thursday?' })).toBeVisible();
  });

  test("the address in a message's header goes to the sender", async ({ page }) => {
    await page.goto('/?message=m6&account=me%40example.org');
    await panel(page).getByRole('link', { name: 'ada@example.org' }).click();
    await expect(page.getByRole('heading', { name: 'Ada Lovelace', level: 1 })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });

  test("a rule's domain goes to the domain and its address to the sender, not to the rule", async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('link', { name: 'news.example.com' }).click();
    await expect(page.getByRole('heading', { name: 'news.example.com', level: 1 })).toBeVisible();
    expect(search(page).get('rule')).toBeNull();

    await page.goBack();
    await page.getByRole('link', { name: 'orders@shop.example.com' }).click();
    await expect(page.getByRole('heading', { name: 'Shop', level: 1 })).toBeVisible();
    expect(search(page).get('rule')).toBeNull();
  });

  test('the sender in a rule For review offers goes to the sender', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('listitem').filter({ hasText: 'Make a rule…' }).getByRole('link', { name: 'billing@utility.example.net' }).click();
    expect(new URL(page.url()).pathname).toBe('/sender/me%40example.org/billing%40utility.example.net');
  });
});

test.describe('A domain', () => {
  test('shows what its mail is, who writes from it, and their mail', async ({ page }) => {
    await page.goto(DOMAIN);
    await expect(page.getByRole('heading', { name: 'code.example.com', level: 1 })).toBeVisible();
    await expect(page.getByRole('row', { name: /^Notifications 5 · 71%/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /^Account alerts 2 · 29%/ })).toBeVisible();
    await expect(
      page
        .getByRole('table')
        .nth(1)
        .getByRole('row')
        .filter({ has: page.getByRole('link', { name: 'Dependabot' }) }),
    ).toContainText('notifications@code.example.com');
    await expect(
      page
        .getByRole('table')
        .nth(2)
        .getByRole('row')
        .filter({ has: page.getByRole('cell') }),
    ).toHaveCount(8);
    for (const name of ['Trust', 'Unwanted', 'Block']) await expect(standing(page, name)).toHaveAttribute('aria-pressed', 'false');
  });

  test('Block is on for everyone at the domain in one press', async ({ page }) => {
    await page.goto(DOMAIN);
    await standing(page, 'Block').click();
    await expect(ruleToast(page, 'Mail from code.example.com: send it to spam')).toContainText('Rule added');
    await expect(standing(page, 'Block')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('On a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a rule's toast says Rule added above the rule, where after it the two would wrap apart", async ({ page }) => {
    await page.goto(SENDER);
    await standing(page, 'Block').click();
    const said = ruleToast(page, 'Mail from notifications@code.example.com: send it to spam');
    const kind = (await said.getByText('Rule added', { exact: true }).boundingBox())!;
    const rule = (await said.getByText('Mail from notifications@code.example.com: send it to spam', { exact: true }).boundingBox())!;
    expect(kind.y + kind.height / 2).toBeLessThan(rule.y);
  });

  test('a For review row opens its message over the whole screen, and Close returns to the list', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('row').filter({ hasText: 'Lunch on Thursday?' }).click();
    const open = panel(page);
    await expect(open.getByRole('heading', { name: 'Lunch on Thursday?' })).toBeVisible();
    expect((await open.boundingBox())?.width).toBeCloseTo(390, 0);
    expect(await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBe(0);

    await open.getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });

  test('the sender in a For review row goes to the sender, not the message', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('row').filter({ hasText: 'Winter sale starts now' }).getByRole('link', { name: 'Store' }).click();
    await expect(page.getByRole('heading', { name: 'Store', level: 1 })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/sender/me%40example.org/sale%40store.example.com');
    expect(search(page).get('message')).toBeNull();
  });

  test('a sender page fits the screen', async ({ page }) => {
    await page.goto(SENDER);
    await expect(page.getByRole('heading', { name: 'Names' })).toBeVisible();
    expect(await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBe(0);
  });
});
