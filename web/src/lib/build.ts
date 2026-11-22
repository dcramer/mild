import { useSyncExternalStore } from 'react';

/** The build this page came with (next.config.js). */
export const BUILT = process.env.MILD_BUILD ?? null;

let stale = false;
const listeners = new Set<() => void>();

/**
 * Which build the server is, as `/api/session` says. Another than the page's means Mild was updated while the page was
 * open: the page carries on, and the next screen it goes to is loaded whole, from the new one.
 */
export function serverBuild(build: string | null): void {
  if (stale || !build || !BUILT || build === BUILT) return;
  stale = true;
  // The service worker served this page as the newest it knew of; it fetches pages again first from now.
  navigator.serviceWorker?.controller?.postMessage({ build });
  // Just opened, from the service worker's copy of an older build: open again, as the newer one, before anything is done
  // here. Once a build: should the worker still serve the older, the page carries on and the next screen loads whole.
  if (performance.now() < FRESH_MS && reloadingFor() !== build) {
    try {
      window.sessionStorage.setItem(RELOADED, build);
    } catch {
      return;
    }
    window.location.reload();
    return;
  }
  for (const listener of listeners) listener();
}

/** How long after the page opens it may still load itself again as a newer build without anything being lost. */
const FRESH_MS = 10_000;
/** The build the page last loaded itself again for, in this tab. */
const RELOADED = 'sift:reloaded-for';
const reloadingFor = () => {
  try {
    return window.sessionStorage.getItem(RELOADED);
  } catch {
    return null;
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** True once the server is another build than the page: a link loads the page it goes to. */
export const useStale = () =>
  useSyncExternalStore(
    subscribe,
    () => stale,
    () => false,
  );

export const isStale = () => stale;
