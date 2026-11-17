import { createCn } from 'cn/config';

/**
 * Joins classes, a later one winning where two set the same thing. The type scale's own steps
 * (`web/src/index.css`) are named here as sizes: unknown, `text-label` reads as a colour and the
 * colour beside it removes it.
 */
export const cn = createCn({ extend: { classGroups: { 'font-size': [{ text: ['head', 'label', 'reading'] }] } } });
