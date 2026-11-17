import { useSyncExternalStore } from 'react';

// Sections were address fragments once (`/#settings/accounts`); those links still arrive.
if (window.location.pathname === '/' && /^#\/?[a-z]/.test(window.location.hash)) {
  window.history.replaceState(null, '', `/${window.location.hash.replace(/^#\/?/, '')}`);
}

/** Paths the server answers itself; a link to one loads it. */
const SERVER = /^\/(api|auth|dev|assets)\//;

// Where the page is. Kept here, not read from the address each time, because a browser may refuse to
// rewrite the address too often (Safari, while someone types in a search box) and the page must still follow.
let at = window.location.pathname + window.location.search;
const listeners = new Set<() => void>();
const moved = (to: string) => {
  at = to;
  for (const listener of listeners) listener();
};
window.addEventListener('popstate', () => moved(window.location.pathname + window.location.search));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const pathOf = (address: string) => address.split('?')[0] ?? '/';
const queryOf = (address: string) => new URLSearchParams(address.split('?')[1] ?? '');

/**
 * Go to `to`, a path with its query, without loading the page again. `replace` rewrites the current
 * history entry and keeps its state; otherwise a new entry is added, carrying `state`.
 */
function navigate(to: string, { replace = false, state = null }: { replace?: boolean; state?: unknown } = {}) {
  try {
    if (replace) window.history.replaceState(window.history.state, '', to);
    else window.history.pushState(state, '', to);
  } catch {
    // The address is behind; the page is not.
  }
  if (!replace && pathOf(to) !== pathOf(at)) window.scrollTo(0, 0);
  moved(to);
}

// A press on a link to another part of the dashboard goes there without loading the page again.
document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a') : null;
  if (!link || !link.hasAttribute('href') || link.target !== '' || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (url.origin !== window.location.origin || SERVER.test(url.pathname)) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
});

/** Where the viewer is, as the parts of the path: `/settings/accounts` is `['settings', 'accounts']`. */
export function useRoute(): string[] {
  const path = useSyncExternalStore(subscribe, () => pathOf(at));
  return path.split('/').filter(Boolean);
}

/**
 * Set or, with `''`, remove values in the address's query. With `push` it adds a history entry, so Back
 * undoes it, and marks the entry with `state`; otherwise it rewrites the current one.
 */
export function setParams(changes: Record<string, string>, push?: { state: unknown }) {
  const query = queryOf(at);
  for (const [name, value] of Object.entries(changes)) {
    if (value === '') query.delete(name);
    else query.set(name, value);
  }
  const text = query.toString();
  navigate(pathOf(at) + (text ? `?${text}` : ''), push ? { state: push.state } : { replace: true });
}

/** One value in the address's query now, for code that runs after a press, outside rendering. */
/** A message as a list's rows name it (`holds`), which is how the panel finds its way back to one. */
export const messageKey = (m: { accountId: string; messageId: string }) => `${m.accountId}/${m.messageId}`;

export const paramNow = (name: string) => queryOf(at).get(name) ?? '';

/**
 * One value kept in the address's query (`?q=invoice`), so a narrowed view can be bookmarked and
 * survives a reload. `''` is "not set". Given `options`, the `[value, label]` pairs of the control it
 * feeds, anything else in the address counts as not set.
 */
export function useParam<T extends string = string>(name: string, options?: readonly (readonly [T, string])[]): [T, (value: T) => void] {
  const raw = useSyncExternalStore(subscribe, () => queryOf(at).get(name) ?? '');
  const value = !options || options.some(([key]) => key === raw) ? (raw as T) : ('' as T);
  return [value, (next) => setParams({ [name]: next })];
}
