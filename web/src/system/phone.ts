'use client';
import { useSyncExternalStore } from 'react';

// The `phone` variant in `web/src/index.css`.
const PHONE = 'not ((width >= 48rem) and (height >= 30rem))';
const subscribe = (changed: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
};

/** Whether the page has its phone layout, for what a class cannot change: a press that selects there and opens wider. False on the server. */
export const usePhone = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
