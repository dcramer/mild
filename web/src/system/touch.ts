/** Whether the screen is worked by finger: nothing rests on anything, so no tooltip, and no keyboard to speak of, so no key hints. */
export const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
