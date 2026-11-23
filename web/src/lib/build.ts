import { useSyncExternalStore } from 'react';
import { onBuild } from './api.ts';

/** The build this page came with (next.config.js). */
export const BUILT = process.env.MILD_BUILD ?? null;

/** The newer build the server is, once it has said so. */
let newer: string | null = null;
const listeners = new Set<() => void>();

/**
 * Which build the server is, as every reply of the API says (`x-sift-build`). Another than the page's means Mild was
 * updated while the page was open. Just opened, the page loads itself again at once. Otherwise it carries on: the next
 * screen it goes to is loaded whole, from the new build, and it loads itself again at the first moment that loses
 * nothing (`reloadWhenSafe`).
 */
function serverBuild(build: string | null): void {
  if (newer || !build || !BUILT || build === BUILT) return;
  newer = build;
  // The service worker served this page as the newest it knew of; it fetches pages again first from now.
  navigator.serviceWorker?.controller?.postMessage({ build });
  if (performance.now() < FRESH_MS && reload()) return;
  for (const listener of listeners) listener();
  if (reloadingFor() !== build) reloadWhenSafe();
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

/**
 * Loads the page again as the newer build, once a build: should the service worker still serve the older (Mild not
 * answering within its patience), the page carries on and the next screen loads whole.
 */
function reload(): boolean {
  if (!newer || reloadingFor() === newer) return false;
  try {
    window.sessionStorage.setItem(RELOADED, newer);
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Untouched this long, a page in view is one nobody is at: an app left open on a screen. */
const IDLE_MS = 10 * 60_000;
const TOUCHED = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Reloads once the page is put away, or has been left untouched while in view, and a reload would lose nothing then;
 * else at the next such moment. Presses are not lost: the outbox keeps them on the device for the page that opens
 * next, and one held under its toast is sent as the page goes. Nor is a draft, kept as it is written, its box opened
 * again from the address.
 */
function reloadWhenSafe() {
  let timer = setTimeout(left, IDLE_MS);
  function left() {
    if (losesSomething()) timer = setTimeout(left, IDLE_MS);
    else reload();
  }
  const touched = () => {
    clearTimeout(timer);
    timer = setTimeout(left, IDLE_MS);
  };
  const away = () => document.visibilityState === 'hidden' && !losesSomething() && reload();
  for (const event of TOUCHED) window.addEventListener(event, touched, { passive: true, capture: true });
  document.addEventListener('visibilitychange', away);
  away();
}

let uploading = 0;

/** Holds off reloading while a file is on its way up, which a reload would stop. Returns its release. */
export function holdReload(): () => void {
  uploading++;
  return () => void uploading--;
}

/**
 * What a reload would lose: a file on its way up, a field being typed in, a dialog open over the page (a rule's or a
 * label's form is kept nowhere until it is saved).
 */
function losesSomething(): boolean {
  if (uploading > 0 || document.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const at = document.activeElement;
  return at instanceof HTMLElement && (at.isContentEditable || at.matches('textarea, select, input:not([type="checkbox"], [type="radio"])'));
}

onBuild(serverBuild);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** True once the server is another build than the page: a link loads the page it goes to. */
export const useStale = () =>
  useSyncExternalStore(
    subscribe,
    () => newer !== null,
    () => false,
  );

export const isStale = () => newer !== null;
