import { createCn } from 'cn/config';

/**
 * Joins classes, a later one winning where two set the same thing. The type scale's own steps
 * (`web/src/index.css`) are named here as sizes: unknown, `text-label` reads as a colour and the
 * colour beside it removes it.
 */
export const cn = createCn({ extend: { classGroups: { 'font-size': [{ text: ['head', 'label', 'reading'] }] } } });

/**
 * Runs `then` once what has just been drawn is on the screen: a press draws what it changes first and does the rest
 * after. A plain timeout can run before the paint it is meant to wait for.
 */
export const afterPaint = (then: () => void) => requestAnimationFrame(() => setTimeout(then));

/** Once the page has nothing else to do, or a second from now at the latest. */
export const idle = () => new Promise((done) => ('requestIdleCallback' in window ? requestIdleCallback(done, { timeout: 1000 }) : setTimeout(done)));
