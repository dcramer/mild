import { flushSync } from 'react-dom';

/** The phone's layout: the `phone` variant in `web/src/index.css`. */
export const PHONE_LAYOUT = 'not ((width >= 48rem) and (height >= 30rem))';

/**
 * Opens or closes the reader as a press does, and on a phone moves it as a phone's apps do: it slides in over the list
 * and back out (`reader-open` and `reader-back` in `web/src/index.css`). `update` makes the change; one that waits
 * (Back, which the browser follows a moment later) returns a promise. A browser's or a gesture's Back is not a press
 * here and does not move, so it never moves twice where Safari slides it itself.
 */
export function moveReader(way: 'open' | 'back', update: () => void | Promise<void>) {
  if (!('startViewTransition' in document) || !window.matchMedia(PHONE_LAYOUT).matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    void update();
    return;
  }
  const root = document.documentElement;
  root.dataset['motion'] = `reader-${way}`;
  const transition = document.startViewTransition(async () => {
    await new Promise<void>((done) => {
      flushSync(() => {
        const waiting = update();
        if (waiting) void waiting.then(done);
        else done();
      });
    });
    // What the change set React drawing, drawn before the new page is taken.
    await new Promise((drawn) => setTimeout(drawn));
  });
  void transition.finished.finally(() => delete root.dataset['motion']);
}
