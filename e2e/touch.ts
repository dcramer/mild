import { expect, type Locator, type Page } from '@playwright/test';
import { PHONE } from './fixture.ts';
import { boxOf } from './wait.ts';

/** A phone's touch screen, which the gestures need: what a finger does is sent as touches, which the page scrolls by. */
export const TOUCH = { viewport: PHONE, hasTouch: true, isMobile: true };

async function touches(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', at?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [at] : [] });
}

/**
 * A finger over the middle of `target`, measured now so it can be put down and lifted while the page's clock is held
 * (`page.clock`), which holds the frames a measurement waits for.
 */
export async function fingerOver(target: Locator) {
  const box = await boxOf(target);
  const touch = await touches(target.page());
  return {
    down: () => touch('touchStart', { x: box.x + box.width / 2, y: box.y + box.height / 2 }),
    lift: () => touch('touchEnd'),
  };
}

/**
 * A finger drawn across a row by `dx` pixels and lifted: its swipe scrolls that far, and the browser snaps it and says
 * it has stopped as it does after a finger. Chrome without a screen scrolls for touches sent to it but does not snap
 * after them, so the scroll is asked for directly.
 */
export async function swipe(target: Locator, dx: number) {
  // e2e is typed without the page's DOM.
  type Scrolls = { scrollBy: (to: { left: number; behavior: 'smooth' }) => void };
  await target.locator('[data-swipe]').evaluate((track, by) => (track as unknown as Scrolls).scrollBy({ left: -by, behavior: 'smooth' }), dx);
}

/** A finger drawn in from the screen's left edge at `y` and lifted, as a phone's mail app opens its menu. */
export async function edgeSwipe(page: Page, y: number) {
  const touch = await touches(page);
  await touch('touchStart', { x: 4, y });
  await touch('touchMove', { x: 30, y: y + 2 });
  await touch('touchMove', { x: 90, y: y + 4 });
  await touch('touchEnd');
}

/** A finger held on `target` until `then` shows, and lifted. */
export async function hold(target: Locator, then: Locator) {
  const box = await boxOf(target);
  const touch = await touches(target.page());
  await touch('touchStart', { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(then).toBeVisible();
  await touch('touchEnd');
}
