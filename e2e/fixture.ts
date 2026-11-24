import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { FRAME_POLICY, IMAGES_FRAME_POLICY, PAGE_HEADERS } from '../src/dashboard/policy.ts';
import { FakeGoogle } from '../tests/google.ts';
import { SCRIPTS, launch } from './launch.ts';

export const SEED = join(SCRIPTS, 'seed.ts');
/** The environment variable, one per variant, global setup leaves each seeded home's place and cookie in. */
export const TEMPLATES = 'MILD_E2E_TEMPLATE';
/** Where global setup leaves what the `full` seed holds encrypted, decrypted (`heldValues`, e2e/global-setup.ts). */
export const HELD = 'MILD_E2E_HELD';
/**
 * `full` is verify-sift's seed (its SKILL.md says what is in it); `bare` leaves the work mailbox without labels, so the page is the setting-up steps;
 * `on` has had a pass with Mild on (`--on` in the seed); `chatgpt` reaches its model through a ChatGPT plan; `inbox` has Inbox on, with the
 * text of the inbox's mail, and may send from its first mailbox (`--inbox`).
 */
export type Variant = 'full' | 'bare' | 'on' | 'chatgpt' | 'inbox';

const directives = (policy: string) => new Set(policy.split('; '));
const onPage = directives(PAGE_HEADERS['content-security-policy']);
/** Directives only a message's HTML frame has: what it refuses (a remote image in its inline style) is it working. */
const FRAME_ONLY = [...directives(FRAME_POLICY), ...directives(IMAGES_FRAME_POLICY)].filter((d) => !onPage.has(d));

/**
 * Whether a console error is the message frame refusing something, which is it working: its policy refusing a
 * remote image in an inline style, told by the directive named; or its sandbox refusing the script Playwright
 * reads it with, told by the frame's own address in the words. Not by where the browser says the error came
 * from: Chrome gives the frame's address only when no script is running, and reading the frame is a script.
 */
const framePolicy = (text: string) => text.includes('/api/message/html?') || FRAME_ONLY.some((d) => text.includes(`directive: "${d}"`));

/** A Sentry project on a port nothing listens on, on this machine: what the server sends there is refused, and nothing leaves it. */
export const SENTRY_DSN = 'http://key@127.0.0.1:1/1';

/** Starts verify-sift's `serve.ts` (the app, reaching the fake Google and a stand-in model) on a copy of the seeded home. */
async function start(variant: Variant, cloud: boolean, listing: boolean, sentry: boolean) {
  const template = JSON.parse(process.env[`${TEMPLATES}_${variant}`] ?? 'null') as { dir: string; cookie: string } | null;
  if (!template) throw new Error('e2e/global-setup.ts did not run');
  const dir = mkdtempSync(join(tmpdir(), 'sift-e2e-run-'));
  cpSync(template.dir, dir, { recursive: true });
  const server = await launch(dir, {
    args: listing ? ['--listing'] : [],
    env: { MILD_CLOUD: String(cloud), ...(sentry ? { SENTRY_DSN } : {}) },
  });
  /** Google as the server last wrote it back. */
  const google = () => FakeGoogle.restore(JSON.parse(readFileSync(join(dir, 'google.json'), 'utf8')) as ReturnType<FakeGoogle['save']>);
  const seeded = new Set([...google().mailboxes.values()].flatMap((m) => m.sent().map((s) => s.id)));
  return {
    url: server.url,
    cookie: template.cookie,
    google,
    /** What Gmail was asked to send since the seed, oldest first. */
    sent: () =>
      [...google().mailboxes.values()].flatMap((m) =>
        m
          .sent()
          .filter((s) => !seeded.has(s.id))
          .map((s) => ({ mailbox: m.address, ...s })),
      ),
    stop: async () => {
      await server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Every test gets a signed-in page on its own seeded dashboard, at `/`-relative URLs, and fails if the page logs
 * an error or throws: a content security policy violation shows up only there.
 */
export const test = base.extend<{
  variant: Variant;
  cloud: boolean;
  listing: boolean;
  signedOut: boolean;
  sentry: boolean;
  allow: string[];
  sift: Awaited<ReturnType<typeof start>>;
}>({
  variant: ['full', { option: true }],
  /** `MILD_CLOUD`: a Mild run as a service. False is someone's own copy. */
  cloud: [false, { option: true }],
  /** The inbox also holding 1,200 of the Store's sales, and Gmail never answering a search's second page, so applying a rule to them goes on until stopped. */
  listing: [false, { option: true }],
  /** A visitor nobody is signed in as, on a Mild that can sign them in. */
  signedOut: [false, { option: true }],
  /** Sending to Sentry, at `SENTRY_DSN`: the page's reports are the test's to catch (`page.route`), and the server's go nowhere. */
  sentry: [false, { option: true }],
  /** Console errors a test expects, by part of their text: `status of 409` where the server refuses and the page says why. */
  allow: [[], { option: true }],
  sift: async ({ variant, cloud, listing, sentry }, use) => {
    const sift = await start(variant, cloud, listing, sentry);
    await use(sift);
    await sift.stop();
  },
  baseURL: async ({ sift }, use) => use(sift.url),
  context: async ({ context, sift, signedOut }, use) => {
    if (!signedOut) await context.addCookies([{ name: 'sift_session', value: sift.cookie, url: sift.url, httpOnly: true }]);
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

/** A phone's screen, for `test.use({ viewport: PHONE })` or `page.setViewportSize(PHONE)`. */
export const PHONE = { width: 390, height: 844 };

/** `test`, for one where the server refuses (409) and the page shows why: the browser logs the refused request as an error. */
export const refused = test.extend({ allow: async ({ allow }, use) => use([...allow, 'status of 409']) });
