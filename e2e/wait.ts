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

/**
 * Holds every animation the page starts from now on with `Element.animate` at its start, to be looked at part way
 * through: a busy machine draws a short one's first and last frames and none between. `at` moves each to that fraction
 * of its duration once one has started, and fails if none does; `release` plays them on.
 */
export async function holdMotion(page: Page) {
  await page.evaluate(`(() => {
    const animate = Element.prototype.animate;
    window.held = [];
    Element.prototype.animate = function (...args) {
      const run = animate.apply(this, args);
      run.pause();
      window.held.push(run);
      return run;
    };
  })()`);
  return {
    at: async (fraction: number) => {
      await expect.poll(() => page.evaluate<number>('window.held.length')).toBeGreaterThan(0);
      await page.evaluate(`window.held.forEach((run) => { run.currentTime = run.effect.getTiming().duration * ${fraction}; })`);
    },
    release: () => page.evaluate('window.held.forEach((run) => run.play())'),
  };
}

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

/**
 * Starts recording what moved on the page that no press moved (the layout shifts Chromium reports), from the next page
 * loaded on: read with `shifts`, an empty list when nothing did.
 */
export const watchShifts = (page: Page) =>
  page.addInitScript(`window.shifts = [];
new PerformanceObserver((list) => {
  for (const shift of list.getEntries())
    if (!shift.hadRecentInput)
      window.shifts.push(...shift.sources.map((source) => (source.node?.textContent ?? source.node?.nodeName ?? '?').trim().slice(0, 60) + ' ' + JSON.stringify(source.previousRect) + ' → ' + JSON.stringify(source.currentRect)));
}).observe({ type: 'layout-shift', buffered: true });`);

/**
 * Waits for this device to hold its key and the whole frame, as it does once a page has drawn: the page keeps them after
 * Mild answers, with no request to wait on.
 */
export const frameKept = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(`new Promise((done) => {
        const opening = indexedDB.open('sift-device');
        // Not made here: the page would find it made without its stores.
        opening.onupgradeneeded = () => opening.transaction.abort();
        opening.onerror = () => done({ key: 0, frame: [] });
        opening.onsuccess = () => {
          const db = opening.result;
          const reading = db.transaction(['key', 'frame']);
          const key = reading.objectStore('key').count();
          const frame = reading.objectStore('frame').getAllKeys();
          reading.oncomplete = () => (db.close(), done({ key: key.result, frame: frame.result }));
        };
      })`),
    )
    .toEqual({ key: 1, frame: ['manage', 'session', 'suggestions-false', 'usage'] });

/** Drop what the device kept of the frame under `name`. */
export const forget = (name: string) => `new Promise((done) => {
  indexedDB.open('sift-device').onsuccess = (event) => {
    const db = event.target.result;
    const removing = db.transaction('frame', 'readwrite');
    removing.objectStore('frame').delete('${name}');
    removing.oncomplete = () => (db.close(), done());
  };
})`;

/** What `watchShifts` recorded, once the page has stopped moving. */
export async function shifts(page: Page) {
  await settled(page);
  return page.evaluate<string[]>('window.shifts');
}
