import type { Page } from '@playwright/test';
import { expect, panel, settled, test } from './sift.ts';

const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true });
/** Settings' Active group: This browser has a Turn on and Turn off of its own, for keyboard shortcuts. */
const active = (page: Page) => settings(page).getByRole('heading', { name: 'Active' }).locator('xpath=ancestor::section[1]');
const offCallout = (page: Page) => page.getByRole('heading', { name: 'Sift is off' });
const QUESTION = 'Archive, label and mark spam on new mail by itself?';

const goThrough = (page: Page) => page.getByRole('dialog', { name: 'Go through your inbox?' });

async function turnOn(page: Page) {
  await active(page).getByRole('button', { name: 'Turn on', exact: true }).click();
  await active(page).getByRole('group', { name: QUESTION }).getByRole('button', { name: 'Turn on', exact: true }).click();
  await goThrough(page).getByRole('button', { name: 'Not now' }).click();
  await expect(active(page).getByRole('button', { name: 'Turn off' })).toBeVisible();
}

test.describe('Settings', () => {
  test('turning Sift on offers to go through the inbox, with what it would cost', async ({ page }) => {
    await page.goto('/?settings=1');
    await active(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    await active(page).getByRole('group', { name: QUESTION }).getByRole('button', { name: 'Turn on', exact: true }).click();
    await expect(goThrough(page).getByText('$3.10')).toBeVisible();
    await expect(goThrough(page).getByText('1,830')).toBeVisible();
    await goThrough(page).getByRole('button', { name: 'Go through 2,412' }).click();
    await expect(goThrough(page)).toHaveCount(0);
    await expect(active(page).getByText('On', { exact: true })).toBeVisible();
    await expect(active(page).getByText('Going through your inbox')).toBeVisible();
    await expect(active(page).getByText('Reading your inbox · 0 found')).toBeVisible();
    // Only one at a time: the row is where it is going, not a press to start another.
    await expect(active(page).getByRole('button', { name: /^Go through/ })).toHaveCount(0);
  });

  test('goes through the inbox from Settings, and stops', async ({ page }) => {
    await page.goto('/?settings=1');
    await expect(active(page).getByText('2,412 messages. Going through them costs about $3.10.')).toBeVisible();
    await active(page).getByRole('button', { name: 'Go through…' }).click();
    await goThrough(page).getByRole('button', { name: 'Go through 2,412' }).click();
    await active(page).getByRole('button', { name: 'Stop' }).click();
    await expect(active(page).getByText('Stopped after 0 messages', { exact: false })).toBeVisible();
    await expect(active(page).getByRole('button', { name: 'Go through again…' })).toBeVisible();
    // Off, what it goes through is only suggested about; Not now leaves it.
    await active(page).getByRole('button', { name: 'Go through again…' }).click();
    await goThrough(page).getByRole('button', { name: 'Not now' }).click();
    await expect(goThrough(page)).toHaveCount(0);
    await expect(active(page).getByText('Off', { exact: true })).toBeVisible();
  });

  test('For review says Sift is off, and its button opens Settings', async ({ page }) => {
    await page.goto('/');
    await expect(offCallout(page)).toBeVisible();
    await expect(page.getByText('Nothing here has been done in Gmail.', { exact: false })).toBeVisible();

    await page.getByRole('link', { name: 'Turn Sift on…' }).click();
    await expect(settings(page)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('settings')).toBe('1');
    await expect(active(page).getByText('Nothing in Gmail changes. Sift suggests, and learns from your answers.')).toBeVisible();

    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(settings(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    await expect(offCallout(page)).toBeVisible();
  });

  test('the account menu opens Settings over the page it was opened on', async ({ page }) => {
    await page.goto('/labels');
    await page.getByRole('button', { name: 'me@example.org' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(settings(page)).toBeVisible();
    await expect(page).toHaveURL(/\/labels\?settings=1$/);

    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/labels$/);
    await expect(page.getByRole('heading', { name: 'Labels', level: 1 })).toBeVisible();
  });

  test('turning Sift on asks first, and Cancel leaves it off', async ({ page }) => {
    await page.goto('/?settings=1');
    await expect(active(page).getByText('Off', { exact: true })).toBeVisible();
    await active(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    const ask = active(page).getByRole('group', { name: QUESTION });
    await expect(ask.getByRole('button', { name: 'Turn on', exact: true })).toBeFocused();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await settled(page);
    await expect(ask).toHaveCount(0);
    await expect(active(page).getByText('Off', { exact: true })).toBeVisible();

    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(offCallout(page)).toBeVisible();
  });

  test('Escape on the question to turn on puts it back, and leaves Settings open', async ({ page }) => {
    await page.goto('/?settings=1');
    await active(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    await expect(active(page).getByRole('group', { name: QUESTION })).toBeVisible();
    await page.keyboard.press('Escape');
    await settled(page);
    await expect(active(page).getByRole('group', { name: QUESTION })).toHaveCount(0);
    await expect(settings(page)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('settings')).toBe('1');
  });

  test('once on, For review no longer says Sift is off, and off again it does', async ({ page }) => {
    await page.goto('/?settings=1');
    await turnOn(page);
    await expect(active(page).getByText('On', { exact: true })).toBeVisible();
    await expect(active(page).getByText('Sift carries out its decisions in Gmail as each label says.', { exact: false })).toBeVisible();

    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(settings(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await expect(offCallout(page)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await expect(offCallout(page)).toHaveCount(0);

    // Turning off asks nothing: it changes nothing in Gmail.
    await page.goto('/?settings=1');
    await active(page).getByRole('button', { name: 'Turn off' }).click();
    await expect(active(page).getByRole('button', { name: 'Turn on', exact: true })).toBeVisible();
    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(offCallout(page)).toBeVisible();
  });

  test('closed Settings stays closed after a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Turn Sift on…' }).click();
    await expect(settings(page)).toBeVisible();
    await settings(page).getByRole('button', { name: 'Close' }).click();
    await expect(settings(page)).toHaveCount(0);
    await page.reload();
    await expect(offCallout(page)).toBeVisible();
    await expect(settings(page)).toHaveCount(0);
  });

  test('Back closes Settings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'me@example.org' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(settings(page)).toBeVisible();
    await page.goBack();
    await expect(settings(page)).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
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
    expect(new URL(page.url()).searchParams.get('settings')).toBe('1');

    await settings(page).getByRole('button', { name: 'Change provider' }).click();
    await expect(change).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(change).toHaveCount(0);
    await settled(page);
    await expect(settings(page)).toBeVisible();
  });

  test('Settings over an open message closes back onto the message', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('cell', { name: 'Lunch on Thursday?' }).click();
    await expect(panel(page)).toBeVisible();
    const at = page.url();
    await page.goto(`${at}&settings=1`);
    await expect(settings(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
    await settled(page);
    await expect(panel(page)).toBeVisible();
    expect(page.url()).toBe(at);
  });
});
