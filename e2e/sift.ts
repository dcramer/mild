import { type ChildProcess, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';

const SCRIPTS = resolve(import.meta.dirname, '../.claude/skills/verify-sift/scripts');
export const SEED = join(SCRIPTS, 'seed.ts');
/** The environment variable, one per variant, global setup leaves each seeded home's place and cookie in. */
export const TEMPLATES = 'SIFT_E2E_TEMPLATE';
/** `full` is verify-sift's seed (its SKILL.md says what is in it); `bare` leaves the work mailbox without labels, so the page is the setting-up steps. */
export type Variant = 'full' | 'bare';

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? done(address.port) : fail(new Error('no port'))));
    });
  });

/** Starts verify-sift's `serve.ts` (`sift dashboard` with a fake Gmail behind its filter control) on a copy of the seeded home. */
async function start(variant: Variant) {
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
  const { port, child } = await serve(3);
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
export const test = base.extend<{ variant: Variant; allow: string[]; sift: Awaited<ReturnType<typeof start>> }>({
  variant: ['full', { option: true }],
  /** Console errors a test expects, by part of their text: `status of 409` where the server refuses and the page says why. */
  allow: [[], { option: true }],
  sift: async ({ variant }, use) => {
    const sift = await start(variant);
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
    // A message's HTML frame logs what its sandbox and policy refuse (its scripts, remote images): that is them working.
    const expected = [...allow, '/api/message/html?'];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (!expected.some((part) => message.text().includes(part) || message.location().url.includes(part))) errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await use(page);
    expect(errors, 'the page logged errors').toEqual([]);
  },
});

export { expect };

/** `test`, for one where the server refuses (409) and the page shows why: the browser logs the refused request as an error. */
export const refused = test.extend({ allow: async ({ allow }, use) => use([...allow, 'status of 409']) });

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

/** The open message panel. */
export const panel = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'What this message is' }) });
