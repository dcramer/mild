'use client';
import { useSyncExternalStore } from 'react';
import { PHONE_LAYOUT } from '@/lib/motion.ts';

const subscribe = (changed: () => void) => {
  const query = window.matchMedia(PHONE_LAYOUT);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
};

/** Whether the page has its phone layout, for what a class cannot change: a press that selects there and opens wider. False on the server. */
export const usePhone = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_LAYOUT).matches,
    () => false,
  );
