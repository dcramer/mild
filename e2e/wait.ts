import { expect, type Locator, type Page } from '@playwright/test';

/** The address's query (`?a=1&b=2`, or `''`), asked again until it matches: a press may change the address after it returns. */
export const query = (page: Page) => expect.poll(() => new URL(page.url()).search);

/** One parameter of the address, null when it is not there, asked again until it matches. */
export const param = (page: Page, name: string) => expect.poll(() => new URL(page.url()).searchParams.get(name));

/** The address's path, asked again until it matches. */
export const path = (page: Page) => expect.poll(() => new URL(page.url()).pathname);

/**
 * Waits for whatever the last press set moving to start (two frames) and then to finish. A layer that is
 * dismissed slides away before it leaves the page, so without this "it is still open" passes while it is going.
 * Rows pulsing while they load never finish, and move nothing. A string, as e2e is typed without the DOM.
 */
export const settled = (page: Page) =>
  page.evaluate(
    'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))).then(() => Promise.allSettled(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)))',
  );

/** Points at `target` once the page has stopped moving, so what opens on hover is for it, not for whatever slid under the pointer. */
export async function pointAt(target: Locator) {
  await settled(target.page());
  await target.hover();
}

/** The tooltip showing. */
export const tooltip = (page: Page) => page.getByRole('tooltip');

/** How far the page scrolls sideways, asked again until it matches: a part arriving late can widen it. */
export const sideScroll = (page: Page) => expect.poll(() => page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'));

/**
 * Where `target` is once it is on the page and the page has stopped moving: a layer that just opened or closed is still
 * sliding. Waiting for motion before the target arrives would miss its own slide in.
 */
export async function boxOf(target: Locator) {
  await target.waitFor();
  await settled(target.page());
  const box = await target.boundingBox();
  if (!box) throw new Error(`${target.toString()} is not on the page`);
  return box;
}
