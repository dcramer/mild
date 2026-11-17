import type { Page } from '@playwright/test';
import { choose, expect, panel, row, test } from './sift.ts';

const DEALS = '/?message=m4&account=me%40example.org';

const search = (page: Page) => new URL(page.url()).searchParams;

/**
 * Every request beyond `origin` the browser did not refuse under the content security policy. A refused one is
 * reported as a request and then as failed, and never leaves the browser.
 */
function remote(page: Page, origin: string) {
  const sent = new Set<string>();
  page.on('request', (request) => void (new URL(request.url()).origin !== origin && sent.add(request.url())));
  page.on('requestfailed', (request) => void (request.failure()?.errorText === 'csp' && sent.delete(request.url())));
  return sent;
}

const mailFrame = (page: Page, subject: string) => page.frameLocator(`iframe[title="${subject}"]`);

test.describe('A message as its HTML', () => {
  test('shows by default, and loads nothing from elsewhere', async ({ page, sift }) => {
    const sent = remote(page, sift.url);
    await page.goto(DEALS);
    const open = panel(page);
    await expect(open.getByRole('radio', { name: 'HTML' })).toBeChecked();
    await expect(open.getByText('Remote images are blocked')).toBeVisible();
    const frame = mailFrame(page, '48 hours only: 30% off');
    await expect(frame.getByRole('heading', { name: '30% off everything' })).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Shop the sale' })).toBeVisible();
    await expect(frame.getByText('Preferences')).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Preferences' })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expect.poll(() => [...sent]).toEqual([]);
  });

  test('a link in it opens in a new tab, and the panel stays', async ({ page, context }) => {
    await context.route('https://shop.example.com/**', (route) => route.fulfill({ body: 'elsewhere', contentType: 'text/plain' }));
    await page.goto(DEALS);
    const opened = context.waitForEvent('page');
    await mailFrame(page, '48 hours only: 30% off').getByRole('link', { name: 'Shop the sale' }).click();
    const tab = await opened;
    await expect.poll(() => tab.url()).toBe('https://shop.example.com/sale');
    await tab.close();
    await expect(panel(page).getByRole('heading', { name: '48 hours only: 30% off' })).toBeVisible();
    expect(search(page).get('message')).toBe('m4');
  });

  test('Text, once chosen, is kept in the browser', async ({ page }) => {
    await page.goto(DEALS);
    const open = panel(page);
    await open.getByRole('radio', { name: 'Text' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(open.getByText('Remote images are blocked')).toHaveCount(0);
    await expect(open.getByText('Everything must go.')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sift:message-view'))).toBe('text');

    await page.reload();
    await expect(panel(page).getByRole('radio', { name: 'Text' })).toBeChecked();
    await expect(page.locator('iframe')).toHaveCount(0);

    await panel(page).getByRole('radio', { name: 'HTML' }).click();
    await expect(mailFrame(page, '48 hours only: 30% off').getByRole('heading', { name: '30% off everything' })).toBeVisible();
  });

  test('mail held as text alone, or not held, has nothing to choose', async ({ page }) => {
    await page.goto('/?message=m6&account=me%40example.org');
    await expect(panel(page).getByText('Are you free for lunch on Thursday?')).toBeVisible();
    await expect(panel(page).getByRole('radiogroup', { name: 'Read it as' })).toHaveCount(0);

    await page.goto('/activity?show=all&message=m1&account=me%40example.org');
    await expect(panel(page).getByText('Sift does not hold this message’s text.')).toBeVisible();
    await expect(panel(page).getByRole('radiogroup', { name: 'Read it as' })).toHaveCount(0);
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(DEALS);
    await expect(mailFrame(page, '48 hours only: 30% off').getByRole('heading', { name: '30% off everything' })).toBeVisible();
    expect((await page.locator('iframe').boundingBox())?.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBe(0);
  });
});

test.describe('What Sift saw', () => {
  const seen = (page: Page) =>
    panel(page)
      .getByRole('table')
      .filter({ has: page.getByRole('button', { name: /^Make a rule for mail that/ }) })
      .getByRole('row');

  test('lists what each message showed, and nothing it did not', async ({ page }) => {
    await page.goto(DEALS);
    await expect(seen(page)).toHaveCount(6);
    for (const words of [
      'Came through a mailing list promo.example.com',
      'Has a one-click unsubscribe Sift can use it',
      'Was sent through a bulk mail service Mailchimp',
      'Has replies going elsewhere',
      'Is in Promotions',
      'Has a tracking pixel And its links are tracked',
    ])
      await expect(seen(page).filter({ has: page.getByRole('cell', { name: words }) })).toHaveCount(1);

    await page.goto('/?message=m7&account=me%40example.org');
    await expect(seen(page)).toHaveCount(1);
    await expect(seen(page)).toContainText('Has attachments');

    await page.goto('/?message=m6&account=me%40example.org');
    await expect(seen(page)).toHaveCount(1);
    await expect(seen(page)).toContainText('Is a reply');
  });

  test('a rule from a fact opens over the panel, and closing it leaves the panel open', async ({ page }) => {
    await page.goto(DEALS);
    await panel(page).getByRole('button', { name: 'Make a rule for mail that has a one-click unsubscribe' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await expect(dialog.getByRole('textbox')).toHaveValue('Mail from deals@promo.example.com that has a one-click unsubscribe: ');
    expect(page.url()).toMatch(/\/\?message=m4&account=me%40example\.org$/);

    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Value 1' })).toHaveValue('deals@promo.example.com');
    await expect(dialog.getByRole('combobox', { name: 'Condition 2' })).toHaveText(/has a one-click unsubscribe/);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(panel(page).getByRole('heading', { name: '48 hours only: 30% off' })).toBeVisible();
    expect(page.url()).toMatch(/\/\?message=m4&account=me%40example\.org$/);

    await panel(page).getByRole('button', { name: 'Make a rule…' }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    expect(search(page).get('message')).toBe('m4');
  });

  test('a rule added from the panel opens over it, and Escape closes the rule, then the panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Winter sale starts now' }).click();
    await panel(page).getByRole('button', { name: 'Make a rule…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    // Looking at the inbox asks Gmail, which is not here.
    await dialog.getByRole('checkbox', { name: 'Apply to mail already there' }).uncheck();
    await dialog.getByRole('button', { name: 'Add rule', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'sale@store.example.com' });
    await expect(sheet).toContainText('Marketing');
    expect(search(page).get('message')).toBe('m8');
    expect(search(page).has('rule')).toBe(true);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(panel(page).getByRole('heading', { name: 'Winter sale starts now' })).toBeVisible();
    expect(search(page).has('rule')).toBe(false);

    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByRole('cell', { name: 'Winter sale starts now' })).toHaveCount(0);
  });

  test('a label added from the panel leaves the panel open on the message', async ({ page }) => {
    await page.goto('/?message=m7&account=me%40example.org');
    await choose(panel(page), 'Add a label…');
    const dialog = page.getByRole('dialog', { name: 'Add labels' });
    await dialog.getByRole('button', { name: 'Write one yourself' }).click();
    const manual = page.getByRole('dialog', { name: 'Add a label' });
    await manual.getByRole('textbox', { name: 'Name' }).fill('Field trips');
    await manual.getByRole('button', { name: 'Add label', exact: true }).click();
    await expect(manual).toHaveCount(0);
    await expect(panel(page).getByRole('heading', { name: 'Notes from the review' })).toBeVisible();
    expect(search(page).get('message')).toBe('m7');

    await choose(panel(page), 'Field trips');
    await expect(panel(page).getByRole('button', { name: 'Save: Field trips' })).toBeVisible();
  });

  test('a rule on a fact alone is for mail from anyone, and re-decides what is waiting', async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a rule' });
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await dialog.getByRole('combobox', { name: 'Condition 1' }).click();
    await page.getByRole('option', { name: 'is in Promotions' }).click();
    await expect(dialog.getByText('From anyone.')).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'Apply to mail already there' }).uncheck();
    await dialog.getByRole('button', { name: 'Add rule', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const sheet = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'mail that is in Promotions' }) });
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);

    await expect(row(page, 'mail that is in Promotions')).toContainText('Archive');
    await expect(page.getByRole('link', { name: 'For review 10' })).toBeVisible();
  });

  test('For review narrowed to replies shows only Ada’s, with a chip that clears it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('radio', { name: 'Is a reply' }).click();
    expect(search(page).get('fact')).toBe('reply');
    const mail = page.getByRole('row').filter({ has: page.getByRole('combobox', { name: 'What this message is' }) });
    await expect(mail).toHaveCount(1);
    await expect(row(page, 'Lunch on Thursday?')).toBeVisible();

    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('button', { name: 'Clear Mail that is a reply' }).click();
    expect(search(page).has('fact')).toBe(false);
    await expect(mail).toHaveCount(9);
  });
});

test.describe('A message opened by its address', () => {
  test('opens over For review, and Close leaves For review with nothing in the address', async ({ page }) => {
    await page.goto('/?message=m6&account=me%40example.org');
    await expect(panel(page).getByRole('heading', { name: 'Lunch on Thursday?' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).search).toBe('');
    await expect(row(page, 'Lunch on Thursday?')).toBeVisible();
  });

  test('Escape closes it, and opening a row afterwards opens that row', async ({ page }) => {
    await page.goto('/?message=m6&account=me%40example.org');
    await expect(panel(page).getByRole('heading', { name: 'Lunch on Thursday?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');

    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    await expect(panel(page).getByRole('heading', { name: 'Notes from the review' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });
});

test.describe('A message opened from a list', () => {
  test('a row of For review opens it, Back closes it, and Forward opens it again', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    await expect(panel(page).getByRole('heading', { name: 'Notes from the review' })).toBeVisible();
    expect(search(page).get('message')).toBe('m7');
    await page.goBack();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');

    await page.goForward();
    await expect(panel(page).getByRole('heading', { name: 'Notes from the review' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close' }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });

  test('the sender link in the panel’s header goes to the sender, closing the panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Notes from the review' }).click();
    await panel(page).getByRole('link', { name: 'Grace Hopper' }).click();
    await expect(page.getByRole('heading', { name: 'Grace Hopper', level: 1 })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/sender/me%40example.org/grace%40example.net');
    expect(new URL(page.url()).search).toBe('');
  });
});
