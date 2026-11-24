import { afterEach, beforeEach, expect, vi } from 'vitest';
import { type FauxModel, fakeGoogle, startSift } from '../fixtures.ts';
import { ACCOUNT } from '../helpers.ts';

/** The person a test signs in as, and someone else, who must see none of their mail. */
export const ME = ACCOUNT;
export const OTHER = 'other@example.com';
/** When each test starts. The clock runs on from it. */
export const AT = Date.UTC(2026, 10, 18, 12);

/**
 * For the file that calls it: Google in memory and the clock at `AT` for each test, and Mild (`startSift`) started on
 * that Google. `settled` is `ME` signed in with a label of their own and the work signing in began done, and `withInbox`
 * that with Inbox on and its copy of their mail made; each gives `arrives`, the next pass, begun by Check now.
 */
export function theApp() {
  const fake = fakeGoogle();
  beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'], now: AT, shouldAdvanceTime: true }));
  afterEach(() => void vi.useRealTimers());

  const start = (options?: Parameters<typeof startSift>[1]) => startSift(fake.google, options);
  const settled = async (model?: FauxModel) => {
    const sift = await start(model ? { model: model.chosen } : {});
    const box = fake.google.mailbox(ME);
    const me = await sift.settled(ME);
    const arrives = async () => {
      expect((await me.call('POST', '/api/check', {})).status).toBe(200);
      await sift.work();
    };
    return { sift, box, me, arrives };
  };
  const withInbox = async (model?: FauxModel) => {
    const app = await settled(model);
    expect((await app.me.call('POST', '/api/mail/on', { on: true })).status).toBe(200);
    await app.sift.work();
    return app;
  };
  return { fake, start, settled, withInbox };
}
