import { useEffect, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
// Safari's alone, and true only for the app opened from the Home Screen, the one place an iPhone draws the count.
const onHomeScreen = () => (navigator as Navigator & { standalone?: boolean }).standalone === true && 'setAppBadge' in navigator;
const permission = (): NotificationPermission | null => (onHomeScreen() && 'Notification' in window ? Notification.permission : null);

/**
 * The count on the installed app's icon: For review's, across every mailbox, as the rail counts it. It is set only while
 * the page runs, so between visits the icon shows what waited when the app was last open. A computer's Chrome or Edge
 * draws it with nothing allowed, and Android not at all. An iPhone draws it only once notifications are allowed, which it
 * asks only from a press: the first press in the app asks, once.
 */
export function useBadge(count: number | undefined): void {
  // Null where nothing is asked.
  const allowed = useSyncExternalStore(subscribe, permission, () => null);
  useEffect(() => {
    if (allowed !== 'default') return;
    const ask = () =>
      void Notification.requestPermission().then(() => {
        for (const listener of listeners) listener();
      });
    document.addEventListener('click', ask, { once: true, capture: true });
    return () => document.removeEventListener('click', ask, { capture: true });
  }, [allowed]);
  useEffect(() => {
    if (count === undefined || !('setAppBadge' in navigator) || (allowed !== null && allowed !== 'granted')) return;
    // Refused where the page is not installed: the icon is only an aid.
    (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => undefined);
  }, [count, allowed]);
}

/** Signing out takes the count off with everything else. */
export const clearBadge = (): Promise<void> => ('clearAppBadge' in navigator ? navigator.clearAppBadge().catch(() => undefined) : Promise.resolve());
