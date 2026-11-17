import { type ChildProcess, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { FRAME_POLICY, pageHeaders } from '../src/dashboard/policy.ts';

const SCRIPTS = resolve(import.meta.dirname, '../.claude/skills/verify-sift/scripts');
export const SEED = join(SCRIPTS, 'seed.ts');
/** The environment variable, one per variant, global setup leaves each seeded home's place and cookie in. */
export const TEMPLATES = 'SIFT_E2E_TEMPLATE';
/**
 * `full` is verify-sift's seed (its SKILL.md says what is in it); `bare` leaves the work mailbox without labels, so the page is the setting-up steps;
 * `on` has had a pass with Sift on (`--on` in the seed).
 */
export type Variant = 'full' | 'bare' | 'on';

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? done(address.port) : fail(new Error('no port'))));
    });
  });

const withTimeout = <T>(work: Promise<T>, ms: number, what: string) =>
  Promise.race([work, new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`${what} in ${ms / 1000}s`)), ms).unref())]);

const directives = (policy: string) => new Set(policy.split('; '));
const onPage = directives(pageHeaders('', false)['content-security-policy']!);
/** Directives only a message's HTML frame has: what it refuses (a remote image in its inline style) is it working. */
const FRAME_ONLY = [...directives(FRAME_POLICY)].filter((d) => !onPage.has(d));

/**
 * Whether a console error is the message frame refusing something, which is it working: its policy refusing a
 * remote image in an inline style, told by the directive named; or its sandbox refusing the script Playwright
 * reads it with, told by the frame's own address in the words. Not by where the browser says the error came
 * from: Chrome gives the frame's address only when no script is running, and reading the frame is a script.
 */
const framePolicy = (text: string) => text.includes('/api/message/html?') || FRAME_ONLY.some((d) => text.includes(`directive: "${d}"`));

/** Starts verify-sift's `serve.ts` (the dashboard alone, with a fake Gmail behind its filter control) on a copy of the seeded home. */
async function start(variant: Variant, cloud: boolean) {
  const template = JSON.parse(process.env[`${TEMPLATES}_${variant}`] ?? 'null') as { dir: string; cookie: string } | null;
  if (!template) throw new Error('e2e/global-setup.ts did not run');
  const dir = mkdtempSync(join(tmpdir(), 'sift-e2e-run-'));
  cpSync(template.dir, dir, { recursive: true });
  // Another process can take the free port before the server binds it; then it tries another.
  const serve = async (tries: number): Promise<{ port: number; child: ChildProcess }> => {
    const port = await freePort();
    const child = spawn(
      'node',
      ['--disable-warning=ExperimentalWarning', join(SCRIPTS, 'serve.ts'), join(dir, 'home'), String(port), join(dir, 'gmail.json')],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, SIFT_CLOUD: String(cloud) },
      },
    );
    let log = '';
    const started = await new Promise<boolean>((ready, fail) => {
      const read = (chunk: Buffer) => {
        log += chunk.toString();
        if (log.includes('Only the dashboard is running')) ready(true);
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.once('exit', (code) => (log.includes('already in use') && tries > 1 ? ready(false) : fail(new Error(`serve.ts exited ${code}:\n${log}`))));
    });
    return started ? { port, child } : serve(tries - 1);
  };
  const { port, child } = await withTimeout(serve(3), 30_000, 'serve.ts did not start');
  return {
    url: `http://127.0.0.1:${port}`,
    cookie: template.cookie,
    stop: async () => {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill();
      await exited;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Every test gets a signed-in page on its own seeded dashboard, at `/`-relative URLs, and fails if the page logs
 * an error or throws: a content security policy violation shows up only there.
 */
export const test = base.extend<{ variant: Variant; cloud: boolean; allow: string[]; sift: Awaited<ReturnType<typeof start>> }>({
  variant: ['full', { option: true }],
  /** `SIFT_CLOUD`: a Sift run as a service. False is someone's own copy. */
  cloud: [false, { option: true }],
  /** Console errors a test expects, by part of their text: `status of 409` where the server refuses and the page says why. */
  allow: [[], { option: true }],
  sift: async ({ variant, cloud }, use) => {
    const sift = await start(variant, cloud);
    await use(sift);
    await sift.stop();
  },
  baseURL: async ({ sift }, use) => use(sift.url),
  context: async ({ context, sift }, use) => {
    await context.addCookies([{ name: 'sift_session', value: sift.cookie, url: sift.url, httpOnly: true }]);
    await use(context);
  },
  page: async ({ page, allow }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() !== 'error' || framePolicy(message.text())) return;
      if (!allow.some((part) => message.text().includes(part))) errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await use(page);
    // A reply still on its way when the test ends would otherwise find its route gone, and log that.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    expect(errors, 'the page logged errors').toEqual([]);
  },
});

export { expect };

/** `test`, for one where the server refuses (409) and the page shows why: the browser logs the refused request as an error. */
export const refused = test.extend({ allow: async ({ allow }, use) => use([...allow, 'status of 409']) });

/** The address's query (`?a=1&b=2`, or `''`), asked again until it matches: a press may change the address after it returns. */
export const query = (page: Page) => expect.poll(() => new URL(page.url()).search);

/** One parameter of the address, null when it is not there, asked again until it matches. */
export const param = (page: Page, name: string) => expect.poll(() => new URL(page.url()).searchParams.get(name));

/** The address's path, asked again until it matches. */
export const path = (page: Page) => expect.poll(() => new URL(page.url()).pathname);

/** A row of a list, found by the text of one of its cells (rows have no name of their own). */
export const row = (page: Page, text: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: text }) });

/** Picks `option` from a row's or the panel's "What this message is" dropdown. */
export async function choose(within: Locator, option: string) {
  await within.getByRole('combobox', { name: 'What this message is' }).click();
  await within.page().getByRole('option', { name: option, exact: true }).click();
}

/**
 * Waits for whatever the last press set moving to start (two frames) and then to finish. A layer that is
 * dismissed slides away before it leaves the page, so without this "it is still open" passes while it is going.
 * A string, as e2e is typed without the DOM.
 */
export const settled = (page: Page) =>
  page.evaluate(
    'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))).then(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)))',
  );

/** Points at `target` once the page has stopped moving, so what opens on hover is for it, not for whatever slid under the pointer. */
export async function pointAt(target: Locator) {
  await settled(target.page());
  await target.hover();
}

/** The tooltip showing. */
export const tooltip = (page: Page) => page.getByRole('tooltip');

/** A phone's screen, for `test.use({ viewport: PHONE })` or `page.setViewportSize(PHONE)`. */
export const PHONE = { width: 390, height: 844 };

/** How far the page scrolls sideways, asked again until it matches: a part arriving late can widen it. */
export const sideScroll = (page: Page) => expect.poll(() => page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'));

/** Where `target` is once the page has stopped moving: a layer that just opened or closed is still sliding. */
export async function boxOf(target: Locator) {
  await settled(target.page());
  const box = await target.boundingBox();
  if (!box) throw new Error(`${target.toString()} is not on the page`);
  return box;
}

/** The open message panel. */
export const panel = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'What this message is' }) });

/** The open message panel's heading: the subject of the message it shows. */
export const panelHeading = (page: Page, subject: string) => panel(page).getByRole('heading', { name: subject, level: 2 });

/** Opens the message in the list by its subject, once the panel shows it. */
export async function openMessage(page: Page, subject: string) {
  await page.getByRole('cell', { name: subject }).click();
  await expect(panelHeading(page, subject)).toBeVisible();
  return panel(page);
}

/** The seed's own account, as it is in an address. */
const ME = encodeURIComponent('me@example.org');

/** What opens message `id` (`m6`) over a page, for after its `?` or `&`. */
export const messageQuery = (id: string) => `message=${id}&account=${ME}`;

/** A sender's page, by their address. */
export const senderPage = (address: string) => `/sender/${ME}/${encodeURIComponent(address)}`;

/** A domain's page. */
export const domainPage = (domain: string) => `/domain/${ME}/${domain}`;

/** For review's rows of mail, without its header. */
export const reviewRows = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('combobox', { name: 'What this message is' }) });

export const reviewSearch = (page: Page) => page.getByRole('searchbox', { name: 'Search senders and subjects' });

/** The masthead's link to For review, whose name ends in how many messages wait. */
export const forReviewLink = (page: Page) => page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^For review/ });

/** A toast, named by what it is about: a rule's by the rule, a label's by the label. */
export const toast = (page: Page, name: string) => page.getByRole('region', { name: 'Notifications' }).getByRole('dialog', { name, exact: true });

/** The section under a heading, with everything in it. */
export const section = (within: Page | Locator, heading: string) =>
  within.getByRole('heading', { name: heading, exact: true }).locator('xpath=ancestor::section[1]');

export const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true });

/** Settings' Active section: This browser has a Turn on and Turn off of its own, for keyboard shortcuts. */
export const settingsActive = (page: Page) => section(settings(page), 'Active');

/** The question Turn on asks in Settings before Sift changes anything in Gmail. */
export const turnOnQuestion = (page: Page) => settingsActive(page).getByRole('group', { name: 'Archive, label and mark spam on new mail by itself?' });

export const goThrough = (page: Page) => page.getByRole('dialog', { name: 'Go through your inbox?' });

/** Opens Settings from the account menu, over the page showing. */
export async function settingsFromMenu(page: Page) {
  await page.getByRole('button', { name: /^Account, / }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(settings(page)).toBeVisible();
}

/** Closes Settings, which takes it out of the address. */
export async function closeSettings(page: Page) {
  await settings(page).getByRole('button', { name: 'Close' }).click();
  await expect(settings(page)).toHaveCount(0);
  await param(page, 'settings').toBeNull();
}

/** In open Settings, Turn on and Turn on again to confirm, which leaves the offer to go through the inbox open. */
export async function confirmTurnOn(page: Page) {
  await settingsActive(page).getByRole('button', { name: 'Turn on', exact: true }).click();
  await turnOnQuestion(page).getByRole('button', { name: 'Turn on', exact: true }).click();
}

/** Opens Settings, turns Sift on and says Not now to going through the inbox. */
export async function turnOn(page: Page) {
  await page.goto('/?settings=1');
  await confirmTurnOn(page);
  await goThrough(page).getByRole('button', { name: 'Not now' }).click();
  await expect(settingsActive(page).getByText('On', { exact: true })).toBeVisible();
}

export const addLabelsDialog = (page: Page) => page.getByRole('dialog', { name: 'Add labels' });

export const addALabelDialog = (page: Page) => page.getByRole('dialog', { name: 'Add a label' });

/** From the open Add labels, Write one yourself, with a name and nothing else. */
export async function writeLabel(page: Page, name: string) {
  await addLabelsDialog(page).getByRole('button', { name: 'Write one yourself' }).click();
  const manual = addALabelDialog(page);
  await manual.getByRole('textbox', { name: 'Name' }).fill(name);
  await manual.getByRole('button', { name: 'Add label', exact: true }).click();
  await expect(manual).toHaveCount(0);
}

/** The first step of setting up a mailbox: its heading, and the box its words go in. */
export const WANT = 'What do you want from Sift?';

/** Setting up, asks for labels for `words`, and waits for the step that offers them. */
export async function suggestLabels(page: Page, words: string) {
  await page.getByRole('textbox', { name: WANT }).fill(words);
  await page.getByRole('button', { name: 'Suggest labels' }).click();
  await expect(page.getByRole('heading', { name: 'Your labels', level: 1 })).toBeVisible();
}

/** Answers requests to `url` with the server's own reply, its JSON as `change` makes it. */
export const patchJson = (page: Page, url: string, change: (json: any) => object) =>
  page.route(url, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: change(await response.json()) });
  });

/**
 * The page as someone whose model is through a ChatGPT plan sees it: the seed's own model is behind an API key,
 * and no harness can sign in to ChatGPT, so Settings' data says so instead. Their model is `gpt-5.6-luna`, at $0.40 per 1,000.
 */
export async function throughChatGPT(page: Page) {
  const model = 'openai-codex/gpt-5.6-luna';
  const chatgpt = { provider: 'openai-codex', label: 'ChatGPT', how: 'device-code' };
  await patchJson(page, '**/api/manage*', (state) => ({
    ...state,
    model: { ...state.model, chosen: model, choices: [chatgpt, ...state.model.choices], signedIn: ['openai-codex'] },
  }));
  await patchJson(page, '**/api/models*', (models) => ({ ...models, models: [model], shortlist: { 'openai-codex': [model] }, costs: { [model]: 0.4 } }));
}
