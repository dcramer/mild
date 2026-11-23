import type { Locator, Page } from '@playwright/test';
import { mailDocument } from '../src/dashboard/mail-html.ts';
import { FRAME_POLICY } from '../src/dashboard/policy.ts';
import { addRule, makeRule, ruleDialog, rulePanel, writeRule } from './rule.ts';
import {
  addLabelsDialog,
  boxOf,
  choose,
  expect,
  forReviewLink,
  messageQuery,
  addressed,
  openMessage,
  back,
  reader,
  readerHeading,
  toast,
  param,
  path,
  PHONE,
  query,
  reviewRows,
  row,
  senderPage,
  sideScroll,
  test,
  writeLabel,
} from './sift.ts';

const DEALS = `/?${messageQuery('m4')}`;

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

/** Shows the open message as its text or its HTML, from its ⋮ menu. */
async function showAs(open: Locator, view: 'text' | 'HTML') {
  await open.getByRole('button', { name: 'More' }).click();
  await open
    .page()
    .getByRole('menuitem', { name: `Show as ${view}` })
    .click();
}

/** A one-pixel PNG, standing in for every image a sender links to. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const mailFrame = (page: Page, subject: string) => page.frameLocator(`iframe[title="${subject}"]`);

test.describe('A message as its HTML', () => {
  test('shows by default, and loads nothing from elsewhere', async ({ page, sift }) => {
    const sent = remote(page, sift.url);
    await page.goto(DEALS);
    const open = reader(page);
    await expect(open.getByText('Remote images are blocked')).toBeVisible();
    const frame = mailFrame(page, '48 hours only: 30% off');
    await expect(frame.getByRole('heading', { name: '30% off everything' })).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Shop the sale' })).toBeVisible();
    await expect(frame.getByText('Preferences')).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Preferences' })).toHaveCount(0);
    // Everything the frame asks for is asked for by the time the network goes quiet; one the policy refused is
    // reported as failed a moment later, so the list is asked again until it has gone.
    await page.waitForLoadState('networkidle');
    await expect.poll(() => [...sent]).toEqual([]);
  });

  test('Show images loads the images it asked for, until it is opened again', async ({ page, sift }) => {
    const sent = remote(page, sift.url);
    await page.route('https://*.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PIXEL, 'base64') }));
    await page.goto(DEALS);
    const open = reader(page);
    await open.getByRole('button', { name: 'Show images' }).click();
    await expect(open.getByText('Remote images are blocked')).toHaveCount(0);
    const frame = mailFrame(page, '48 hours only: 30% off');
    await expect(frame.getByRole('img', { name: '48 hours only' })).toHaveJSProperty('naturalWidth', 1);
    await expect
      .poll(() => [...sent].toSorted())
      .toEqual(['https://images.example.com/hero.png', 'https://images.example.com/paper.png', 'https://track.example.com/open.gif?u=me']);
    await page.goto(DEALS);
    await expect(reader(page).getByRole('button', { name: 'Show images' })).toBeVisible();
  });

  test('a link in it opens in a new tab, and the panel stays', async ({ page, context }) => {
    await context.route('https://shop.example.com/**', (route) => route.fulfill({ body: 'elsewhere', contentType: 'text/plain' }));
    await page.goto(DEALS);
    const opened = context.waitForEvent('page');
    await mailFrame(page, '48 hours only: 30% off').getByRole('link', { name: 'Shop the sale' }).click();
    const tab = await opened;
    await expect.poll(() => tab.url()).toBe('https://shop.example.com/sale');
    await tab.close();
    await expect(readerHeading(page, '48 hours only: 30% off')).toBeVisible();
    await param(page, 'message').toBe('m4');
  });

  test('Text, once chosen, is kept in the browser', async ({ page }) => {
    await page.goto(DEALS);
    const open = reader(page);
    await showAs(open, 'text');
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(open.getByText('Remote images are blocked')).toHaveCount(0);
    await expect(open.getByText('Everything must go.')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sift:message-view'))).toBe('text');

    await page.reload();
    await expect(reader(page).getByText('Everything must go.')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);

    await showAs(reader(page), 'HTML');
    await expect(mailFrame(page, '48 hours only: 30% off').getByRole('heading', { name: '30% off everything' })).toBeVisible();
  });

  test('mail held as text alone, or not held, has nothing to choose', async ({ page }) => {
    await page.goto(`/?${messageQuery('m6')}`);
    await expect(reader(page).getByText('Are you free for lunch on Thursday?')).toBeVisible();
    await expect(reader(page).getByRole('button', { name: 'More' })).toHaveCount(0);

    await page.goto(`/activity?show=all&${messageQuery('m1')}`);
    await expect(reader(page).getByText('Mild does not hold this message’s text.')).toBeVisible();
    await expect(reader(page).getByRole('button', { name: 'More' })).toHaveCount(0);
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(DEALS);
    const frame = mailFrame(page, '48 hours only: 30% off');
    await expect(frame.getByRole('heading', { name: '30% off everything' })).toBeVisible();
    const paper = await boxOf(page.locator('iframe'));
    expect(paper.width).toBeLessThanOrEqual(390);
    // The card is written to shrink to its frame (max-width: 100%), and does: its right edge is not cut off.
    const card = await boxOf(frame.locator('table table'));
    expect(card.x + card.width).toBeLessThanOrEqual(paper.x + paper.width);
    await sideScroll(page).toBe(0);
  });

  test('takes the width a wide screen has, with a card written to centre in the middle of it', async ({ page }) => {
    await page.goto(DEALS);
    const frame = mailFrame(page, '48 hours only: 30% off');
    await expect(frame.getByRole('heading', { name: '30% off everything' })).toBeVisible();
    const paper = await boxOf(page.locator('iframe'));
    // 46rem, the reading column it was once held to.
    expect(paper.width).toBeGreaterThan(736);
    const card = await boxOf(frame.locator('table table'));
    expect(Math.abs(card.x + card.width / 2 - (paper.x + paper.width / 2))).toBeLessThanOrEqual(2);
  });
});

const RELEASE = `/?${messageQuery('m21')}`;
const RELEASE_SUBJECT = 'Re: Fix the release script (#412)';

/** How far the frame's height is from that of the message in it, asked again until it matches: the frame takes its height once the message has said it. */
const frameMisfit = (page: Page, subject: string) =>
  expect.poll(async () =>
    Math.abs((await boxOf(page.locator(`iframe[title="${subject}"]`))).height - (await boxOf(mailFrame(page, subject).locator('html'))).height),
  );

test.describe('A message read as part of the page', () => {
  test('a letter is in the page’s own ink, as tall as it is, with the history it quotes folded behind •••', async ({ page }) => {
    await page.goto(RELEASE);
    const frame = mailFrame(page, RELEASE_SUBJECT);
    await expect(frame.getByText('I pushed a fix for the tag step.')).toBeVisible();
    await expect(frame.locator('body')).toHaveCSS('color', 'rgb(240, 238, 232)');
    await expect(frame.locator('html')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(frame.getByRole('link', { name: 'before Friday' })).toBeVisible();
    const quoted = frame.getByText('The release script stops at the tag step.');
    await expect(quoted).toBeHidden();
    await frameMisfit(page, RELEASE_SUBJECT).toBeLessThanOrEqual(1);
    // Nothing on the page says images were blocked: the letter asked for none.
    await expect(reader(page).getByText('Remote images are blocked')).toHaveCount(0);

    const closed = await boxOf(page.locator('iframe'));
    await frame.getByLabel('Show the quoted text').click();
    await expect(quoted).toBeVisible();
    await expect(frame.getByLabel('Hide the quoted text')).toBeVisible();
    await expect.poll(async () => (await boxOf(page.locator('iframe'))).height).toBeGreaterThan(closed.height);
    await frameMisfit(page, RELEASE_SUBJECT).toBeLessThanOrEqual(1);
  });

  test('its text folds the same history', async ({ page }) => {
    await page.goto(RELEASE);
    const open = reader(page);
    await showAs(open, 'text');
    await expect(open.getByText(/^I pushed a fix for the tag step\./)).toBeVisible();
    await expect(open.getByText(/The release script stops at the tag step\./)).toHaveCount(0);
    await open.getByRole('button', { name: 'Show the quoted text' }).click();
    await expect(open.getByText(/> The release script stops at the tag step\./)).toBeVisible();
    await expect(open.getByRole('button', { name: 'Hide the quoted text' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('designed mail is on its paper, as tall as it is, so the page scrolls as one', async ({ page }) => {
    await page.goto(DEALS);
    const frame = mailFrame(page, '48 hours only: 30% off');
    await expect(frame.getByRole('heading', { name: '30% off everything' })).toBeVisible();
    await expect(frame.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await frameMisfit(page, '48 hours only: 30% off').toBeLessThanOrEqual(1);
  });
});

/** Ada's reply shown as `html` instead, cleaned and sent as Mild sends any message's frame. */
const replyAs = (page: Page, html: string) =>
  page.route('**/api/message/html?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { 'content-security-policy': FRAME_POLICY },
      body: mailDocument(html, false),
    }),
  );

const ASKED = 'Shall we meet at the lake?';
const REPLIED = 'Works for me.';

test.describe('Designed mail on a system set to dark', () => {
  test.use({ colorScheme: 'dark' });

  test('is drawn as written for light, not with its own dark styles on the paper', async ({ page }) => {
    await replyAs(
      page,
      '<style>p{color:#3c4043}@media (prefers-color-scheme: dark){p{color:#e8eaed}}</style><table width="600"><tr><td><p>When</p></td></tr></table>',
    );
    await page.goto(RELEASE);
    const frame = mailFrame(page, RELEASE_SUBJECT);
    await expect(frame.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(frame.getByText('When')).toHaveCSS('color', 'rgb(60, 64, 67)');
  });
});

test.describe('The history a reply quotes, as each mail program writes it', () => {
  const folded = {
    'Outlook on the web': `<div>${REPLIED}</div><div id="appendonsend"></div><hr style="display:inline-block;width:98%"><div id="divRplyFwdMsg"><b>From:</b> Ada<br><b>Sent:</b> Monday</div><div>${ASKED}</div>`,
    Outlook: `<div class="WordSection1"><p class="MsoNormal">${REPLIED}</p><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in"><p class="MsoNormal"><b>From:</b> Ada<br><b>Sent:</b> Monday</p></div><p class="MsoNormal">${ASKED}</p></div>`,
    'Apple Mail': `<div dir="ltr">${REPLIED}</div><div dir="ltr"><br><blockquote type="cite">On Nov 2, 2026, at 09:14, Ada wrote:<br><br><div>${ASKED}</div></blockquote></div>`,
    Thunderbird: `<p>${REPLIED}</p><div class="moz-cite-prefix">On 02/11/2026 09:14, Ada wrote:<br></div><blockquote type="cite">${ASKED}</blockquote><br>`,
  };
  for (const [program, html] of Object.entries(folded))
    test(`folds under a reply from ${program}`, async ({ page }) => {
      await replyAs(page, html);
      await page.goto(RELEASE);
      const frame = mailFrame(page, RELEASE_SUBJECT);
      await expect(frame.getByText(REPLIED)).toBeVisible();
      await expect(frame.getByText(ASKED)).toBeHidden();
      await frame.getByLabel('Show the quoted text').click();
      await expect(frame.getByText(ASKED)).toBeVisible();
    });

  const open = {
    'a reply written between the lines it quotes': `<div>On Mon, Ada wrote:</div><blockquote type="cite">Lunch?</blockquote><div>${REPLIED}</div><blockquote type="cite">${ASKED}</blockquote><div>Yes.</div>`,
    'a forward': `<div dir="ltr">${REPLIED}<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: Ada</div><div>${ASKED}</div></div></div>`,
  };
  for (const [kind, html] of Object.entries(open))
    test(`stays open in ${kind}`, async ({ page }) => {
      await replyAs(page, html);
      await page.goto(RELEASE);
      const frame = mailFrame(page, RELEASE_SUBJECT);
      await expect(frame.getByText(ASKED)).toBeVisible();
      await expect(frame.getByLabel('Show the quoted text')).toHaveCount(0);
    });
});

test.describe('Who a message went to', () => {
  test('a long list folds, so the message fits under it on a phone, opens where it stands, and folds again', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    const open = await openMessage(page, 'Notes from the review');
    await expect(addressed(open, 'Cc')).toHaveText('reviewer1@example.net, reviewer2@example.net, reviewer3@example.net and 9 more');
    await expect(open.getByText(/reviewer12@example\.net/)).toHaveCount(0);
    await expect(open.getByText('Attached are my notes.')).toBeInViewport();

    await open.getByRole('button', { name: '9 more' }).click();
    const fewer = open.getByRole('button', { name: 'Fewer' });
    await expect(fewer).toHaveAttribute('aria-expanded', 'true');
    await expect(addressed(open, 'Cc')).toHaveText(/reviewer12@example\.net Fewer$/);

    // The page scrolls as one, so however long the list is, what is under it can be read.
    const last = open.getByText(/^History · /);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(readerHeading(page, 'Notes from the review')).not.toBeInViewport();
    await sideScroll(page).toBe(0);
    await fewer.scrollIntoViewIfNeeded();

    await fewer.click();
    await expect(open.getByRole('button', { name: '9 more' })).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('What Mild saw', () => {
  const seen = (page: Page) =>
    reader(page)
      .getByRole('table')
      .filter({ has: page.getByRole('button', { name: /^Make a rule for mail that/ }) })
      .getByRole('rowgroup')
      .last()
      .getByRole('row');

  test('lists what each message showed, and nothing it did not', async ({ page }) => {
    await page.goto(DEALS);
    await expect(seen(page)).toHaveCount(6);
    for (const words of [
      'Came through a mailing list promo.example.com',
      'Has a one-click unsubscribe Mild can use it',
      'Was sent through a bulk mail service Mailchimp',
      'Has replies going elsewhere',
      'Is in Promotions',
      'Has a tracking pixel And its links are tracked',
    ])
      await expect(seen(page).filter({ has: page.getByRole('cell', { name: words }) })).toHaveCount(1);

    await page.goto(`/?${messageQuery('m7')}`);
    await expect(seen(page)).toHaveCount(1);
    await expect(seen(page)).toContainText('Has attachments');

    await page.goto(`/?${messageQuery('m6')}`);
    await expect(seen(page)).toHaveCount(1);
    await expect(seen(page)).toContainText('Is a reply');
  });

  test('a rule from a fact opens over the panel, and closing it leaves the panel open', async ({ page }) => {
    await page.goto(DEALS);
    await reader(page).getByRole('button', { name: 'Make a rule for mail that has a one-click unsubscribe' }).click();
    const dialog = ruleDialog(page);
    await expect(dialog.getByRole('textbox')).toHaveValue('Mail from deals@promo.example.com that has a one-click unsubscribe: ');
    await expect(page).toHaveURL(DEALS);

    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Value 1' })).toHaveValue('deals@promo.example.com');
    await expect(dialog.getByRole('combobox', { name: 'Condition 2' })).toHaveText(/has a one-click unsubscribe/);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(readerHeading(page, '48 hours only: 30% off')).toBeVisible();
    await expect(page).toHaveURL(DEALS);

    await makeRule(reader(page));
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(reader(page)).toBeVisible();
    await param(page, 'message').toBe('m4');
  });

  test('a rule added from the panel opens at its own address, and Back returns to the message', async ({ page }) => {
    await page.goto('/');
    const dialog = await makeRule(await openMessage(page, 'Winter sale starts now'));
    await dialog.getByRole('button', { name: 'Write it yourself' }).click();
    await addRule(dialog);
    const sheet = rulePanel(page, 'sale@store.example.com');
    await expect(sheet).toContainText('Marketing');
    await path(page).toMatch(/^\/rules\/r-/);

    await page.goBack();
    await expect(readerHeading(page, 'Winter sale starts now')).toBeVisible();
    await path(page).toBe('/');
    await param(page, 'message').toBe('m8');

    await page.keyboard.press('Escape');
    await expect(reader(page)).toHaveCount(0);
    await query(page).toBe('');
    await expect(page.getByRole('cell', { name: 'Winter sale starts now' })).toHaveCount(0);
  });

  test('a label added from the panel leaves the panel open on the message', async ({ page }) => {
    await page.goto(`/?${messageQuery('m7')}`);
    await choose(reader(page), 'Add a label…');
    await expect(addLabelsDialog(page)).toBeVisible();
    await writeLabel(page, 'Field trips');
    await expect(readerHeading(page, 'Notes from the review')).toBeVisible();
    await param(page, 'message').toBe('m7');

    await choose(reader(page), 'Field trips');
    await expect(toast(page, 'Notes from the review')).toContainText(/Archived\s*to\s*Field trips/);
  });

  test('a rule on a fact alone is for mail from anyone, and re-decides what is waiting', async ({ page }) => {
    await page.goto('/rules');
    const dialog = await writeRule(page);
    await dialog.getByRole('combobox', { name: 'Condition 1' }).click();
    await page.getByRole('option', { name: 'is in Promotions' }).click();
    await expect(dialog.getByText('From anyone.')).toBeVisible();
    await addRule(dialog);
    await expect(dialog).toHaveCount(0);
    const sheet = rulePanel(page, 'mail that is in Promotions');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);

    await expect(row(page, 'mail that is in Promotions')).toContainText('Archive');
    await expect(forReviewLink(page)).toHaveAccessibleName('For review 10');
  });

  test('For review narrowed to replies shows only Ada’s, with a chip that clears it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('radio', { name: 'Is a reply' }).click();
    await param(page, 'fact').toBe('reply');
    await expect(reviewRows(page)).toHaveCount(1);
    await expect(row(page, 'Lunch on Thursday?')).toBeVisible();

    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('button', { name: 'Clear Mail that is a reply' }).click();
    await param(page, 'fact').toBeNull();
    await expect(reviewRows(page)).toHaveCount(9);
  });
});

test.describe('A message opened by its address', () => {
  test('opens over For review, and Close leaves For review with nothing in the address', async ({ page }) => {
    await page.goto(`/?${messageQuery('m6')}`);
    await expect(readerHeading(page, 'Lunch on Thursday?')).toBeVisible();
    await back(page).click();
    await expect(reader(page)).toHaveCount(0);
    await path(page).toBe('/');
    await query(page).toBe('');
    await expect(row(page, 'Lunch on Thursday?')).toBeVisible();
  });

  test('Escape closes it, and opening a row afterwards opens that row', async ({ page }) => {
    await page.goto(`/?${messageQuery('m6')}`);
    await expect(readerHeading(page, 'Lunch on Thursday?')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reader(page)).toHaveCount(0);
    await query(page).toBe('');

    await openMessage(page, 'Notes from the review');
    await back(page).click();
    await expect(reader(page)).toHaveCount(0);
    await query(page).toBe('');
  });
});

test.describe('A message opened from a list', () => {
  test('a row of For review opens it, Back closes it, and Forward opens it again', async ({ page }) => {
    await page.goto('/');
    await openMessage(page, 'Notes from the review');
    await param(page, 'message').toBe('m7');
    await page.goBack();
    await expect(reader(page)).toHaveCount(0);
    await query(page).toBe('');

    await page.goForward();
    await expect(readerHeading(page, 'Notes from the review')).toBeVisible();
    await back(page).click();
    await expect(reader(page)).toHaveCount(0);
    await query(page).toBe('');
  });

  test('the sender link in the panel’s header goes to the sender, closing the panel', async ({ page }) => {
    await page.goto('/');
    await (await openMessage(page, 'Notes from the review')).getByRole('link', { name: 'Grace Hopper' }).click();
    await expect(page.getByRole('heading', { name: 'Grace Hopper', level: 1 })).toBeVisible();
    await expect(reader(page)).toHaveCount(0);
    await path(page).toBe(senderPage('grace@example.net'));
    await param(page, 'message').toBeNull();
  });
});
