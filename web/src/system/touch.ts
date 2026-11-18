import { useSyncExternalStore } from 'react';

const COARSE = '(pointer: coarse)';
const subscribe = (changed: () => void) => {
  const query = window.matchMedia(COARSE);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
};

/**
 * Whether the screen is worked by finger: nothing rests on anything, so no tooltip, and no keyboard to speak of, so no key hints.
 * The server cannot tell, so it draws the page for a pointer, and a touch screen redraws what differs once the page starts.
 */
export const useTouch = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COARSE).matches,
    () => false,
  );
