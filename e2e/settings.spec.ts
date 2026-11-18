import type { Page } from '@playwright/test';
import {
  closeSettings,
  confirmTurnOn,
  expect,
  goThrough,
  messageQuery,
  openMessage,
  param,
  patchJson,
  pointAt,
  query,
  settings,
  settingsActive,
  settingsFromMenu,
  settled,
  test,
  throughChatGPT,
  turnOn,
  turnOnQuestion,
} from './sift.ts';

const offCallout = (page: Page) => page.getByRole('heading', { name: 'Sift is off' });

test.describe('Settings', () => {
  test('turning Sift on offers to go through the inbox, with what it would cost', async ({ page }) => {
    await page.goto('/?settings=1');
    await confirmTurnOn(page);
    await expect(goThrough(page).getByText('$3.10')).toBeVisible();
    await expect(goThrough(page).getByText('1,830')).toBeVisible();
    await goThrough(page).getByRole('button', { name: 'Go through 2,412' }).click();
    await expect(goThrough(page)).toHaveCount(0);
    await expect(settingsActive(page).getByText('On', { exact: true })).toBeVisible();
    await expect(settingsActive(page).getByText('Going through your inbox')).toBeVisible();
    await expect(settingsActive(page).getByText('Reading your inbox · 0 found')).toBeVisible();
    // Only one at a time: the row is where it is going, not a press to start another.
    await expect(settingsActive(page).getByRole('button', { name: /^Go through/ })).toHaveCount(0);
  });

  test.describe(() => {
    test.use({ variant: 'chatgpt' });

    test('through a ChatGPT plan, prices are said to be API prices the plan covers', async ({ page }) => {
      await throughChatGPT(page);
      await patchJson(page, '**/api/summary?days=30*', (summary) => ({ ...summary, totals: { ...summary.totals, costUsd: 4.2, judged: 1234 } }));
      await page.goto('/?settings=1');
      await expect(
        settings(page).getByText(
          'Classifies what no rule covers. $4.20 at API prices in the last 30 days, for 1,234 messages, which your ChatGPT plan covers.',
        ),
      ).toBeVisible();
      await expect(settings(page).getByText('About $0.40 per 1,000 messages at API prices, which your ChatGPT plan covers.')).toBeVisible();
      await expect(settingsActive(page).getByText('2,412 messages. About $3.10 at API prices, which your ChatGPT plan covers.')).toBeVisible();
      await settingsActive(page).getByRole('button', { name: 'Go through…' }).click();
      await expect(goThrough(page).getByText('on gpt-5.6-luna, at API prices')).toBeVisible();
      await goThrough(page).getByRole('button', { name: 'Not now' }).click();
      await closeSettings(page);
      // The masthead's month is only about what the API would have charged, and its card says so.
      await pointAt(page.getByRole('link', { name: /30D$/ }));
      await expect(page.getByText('At API prices, which your ChatGPT plan covers.', { exact: true }).filter({ visible: true })).toBeVisible();
    });
  });

  test('goes through the inbox from Settings, and stops', async ({ page }) => {
    await page.goto('/?settings=1');
    await expect(settingsActive(page).getByText('2,412 messages. Going through them costs about $3.10.')).toBeVisible();
    await settingsActive(page).getByRole('button', { name: 'Go through…' }).click();
    await goThrough(page).getByRole('button', { name: 'Go through 2,412' }).click();
    await settingsActive(page).getByRole('button', { name: 'Stop' }).click();
    await expect(settingsActive(page).getByText('Stopped after 0 messages', { exact: false })).toBeVisible();
    await expect(settingsActive(page).getByRole('button', { name: 'Go through again…' })).toBeVisible();
    // Off, what it goes through is only suggested about; Not now leaves it.
    await settingsActive(page).getByRole('button', { name: 'Go through again…' }).click();
    await goThrough(page).getByRole('button', { name: 'Not now' }).click();
    await expect(goThrough(page)).toHaveCount(0);
    await expect(settingsActive(page).getByText('Off', { exact: true })).toBeVisible();
  });

  test('For review says Sift is off, and its button opens Settings', async ({ page }) => {
    await page.goto('/');
    await expect(offCallout(page)).toBeVisible();
    await expect(page.getByText('Nothing here has been done in Gmail.', { exact: false })).toBeVisible();

    await page.getByRole('link', { name: 'Turn Sift on…' }).click();
    await expect(settings(page)).toBeVisible();
    await param(page, 'settings').toBe('1');
    await expect(settingsActive(page).getByText('Nothing in Gmail changes. Sift suggests, and learns from your answers.')).toBeVisible();

    await closeSettings(page);
    await query(page).toBe('');
    await expect(offCallout(page)).toBeVisible();
  });

  test('the account menu opens Settings over the page it was opened on', async ({ page }) => {
    await page.goto('/labels');
    await settingsFromMenu(page);
    await expect(page).toHaveURL(/\/labels\?settings=1$/);

    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/labels$/);
    await expect(page.getByRole('heading', { name: 'Labels', level: 1 })).toBeVisible();
  });

  test('turning Sift on asks first, and Cancel leaves it off', async ({ page }) => {
    await page.goto('/?settings=1');
    await expect(settingsActive(page).getByText('Off', { exact: true })).toBeVisible();
    await settingsActive(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    const ask = turnOnQuestion(page);
    await expect(ask.getByRole('button', { name: 'Turn on', exact: true })).toBeFocused();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await settled(page);
    await expect(ask).toHaveCount(0);
    await expect(settingsActive(page).getByText('Off', { exact: true })).toBeVisible();

    await closeSettings(page);
    await expect(offCallout(page)).toBeVisible();
  });

  test('Escape on the question to turn on puts it back, and leaves Settings open', async ({ page }) => {
    await page.goto('/?settings=1');
    await settingsActive(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    await expect(turnOnQuestion(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await settled(page);
    await expect(turnOnQuestion(page)).toHaveCount(0);
    await expect(settings(page)).toBeVisible();
    await param(page, 'settings').toBe('1');
  });

  test('once on, For review no longer says Sift is off, and off again it does', async ({ page }) => {
    await turnOn(page);
    await expect(settingsActive(page).getByRole('button', { name: 'Turn off' })).toBeVisible();
    await expect(settingsActive(page).getByText('Sift carries out its decisions in Gmail as each label says.', { exact: false })).toBeVisible();

    await closeSettings(page);
    await query(page).toBe('');
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await expect(offCallout(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await expect(offCallout(page)).toHaveCount(0);

    // Turning off asks nothing: it changes nothing in Gmail.
    await page.goto('/?settings=1');
    await settingsActive(page).getByRole('button', { name: 'Turn off' }).click();
    await expect(settingsActive(page).getByRole('button', { name: 'Turn on', exact: true })).toBeVisible();
    await closeSettings(page);
    await expect(offCallout(page)).toBeVisible();
  });

  test('closed Settings stays closed after a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Turn Sift on…' }).click();
    await expect(settings(page)).toBeVisible();
    await closeSettings(page);
    await page.reload();
    await expect(offCallout(page)).toBeVisible();
    await expect(settings(page)).toHaveCount(0);
  });

  test('Back closes Settings', async ({ page }) => {
    await page.goto('/');
    await settingsFromMenu(page);
    await page.goBack();
    await expect(settings(page)).toHaveCount(0);
    await query(page).toBe('');
  });

  test('Change provider opens over Settings, and closing it leaves Settings open', async ({ page }) => {
    await page.goto('/?settings=1');
    await settings(page).getByRole('button', { name: 'Change provider' }).click();
    const change = page.getByRole('dialog', { name: 'Change provider' });
    await expect(change.getByRole('row', { name: /^Anthropic In use/ })).toBeVisible();

    await change.getByRole('cell', { name: /^OpenAI Billed per message/ }).click();
    const key = page.getByRole('dialog', { name: 'Paste your OpenAI key.' });
    await expect(key).toBeVisible();
    await key.getByRole('button', { name: 'Back' }).click();
    await settled(page);
    await expect(change).toBeVisible();

    await change.getByRole('button', { name: 'Close' }).click();
    await expect(change).toHaveCount(0);
    await settled(page);
    await expect(settings(page)).toBeVisible();
    await param(page, 'settings').toBe('1');

    await settings(page).getByRole('button', { name: 'Change provider' }).click();
    await expect(change).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(change).toHaveCount(0);
    await settled(page);
    await expect(settings(page)).toBeVisible();
  });

  test('Settings over an open message closes back onto the message', async ({ page }) => {
    await page.goto('/');
    const open = await openMessage(page, 'Lunch on Thursday?');
    const at = `?${messageQuery('m6')}`;
    await query(page).toBe(at);
    await page.goto(`/${at}&settings=1`);
    await expect(settings(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
    await settled(page);
    await expect(open).toBeVisible();
    await query(page).toBe(at);
  });
});

test.describe('Check now', () => {
  test('passes the mailboxes in a Workflow run, and says when', async ({ page }) => {
    await page.goto('/?settings=1');
    const check = settingsActive(page).getByText('Check for mail').locator('xpath=ancestor::*[.//button][1]');
    await expect(check.getByText('Starting.')).toBeVisible();
    await check.getByRole('button', { name: 'Check now' }).click();
    await expect(async () => {
      await page.reload();
      await expect(check.getByText('Last checked just now.')).toBeVisible({ timeout: 1000 });
    }).toPass();
  });
});
