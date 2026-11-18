import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';

/** A message as a list's rows name it (`holds`), which is how the panel finds its way back to one. */
export const messageKey = (m: { accountId: string; messageId: string }) => `${m.accountId}/${m.messageId}`;

/** The marks this page puts on a history entry: a panel opened over a list, which Back closes. */
interface Marks {
  panel?: boolean;
}

// The query this page last wrote, for the path it wrote it on. Read in its place, since a browser may refuse to
// rewrite the address too often (Safari, while someone types in a search box) and the page must still follow.
let wrote: { path: string; query: string } | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
const current = () => (wrote && wrote.path === window.location.pathname ? wrote.query : window.location.search.slice(1));
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
};
if (typeof window !== 'undefined') window.addEventListener('popstate', () => (wrote = null));

/**
 * Go to `query` on this path, through the History API, which Next.js follows (`useSearchParams`) without asking the
 * server for anything. With `push` it adds a history entry, so Back undoes it, marked with `push.state`; otherwise it
 * rewrites the current one and keeps its marks.
 */
export function goToQuery(query: string, push?: { state: Marks | null }) {
  const to = window.location.pathname + (query ? `?${query}` : '');
  wrote = { path: window.location.pathname, query };
  // Only this page's own marks: Next.js adds its own to whatever it is given, and does not follow a write that already carries them.
  const { panel } = (window.history.state ?? {}) as Marks;
  try {
    if (push) window.history.pushState(push.state, '', to);
    else window.history.replaceState(panel ? { panel } : null, '', to);
  } catch {
    // The address is behind; the page is not.
  }
  changed();
}

/** Set or, with `''`, remove values in the address's query; `push` as for `goToQuery`. */
export function setParams(changes: Record<string, string>, push?: { state: Marks }) {
  const query = new URLSearchParams(current());
  for (const [name, value] of Object.entries(changes)) {
    if (value === '') query.delete(name);
    else query.set(name, value);
  }
  goToQuery(query.toString(), push);
}

/** One value in the address's query now, for code that runs after a press, outside rendering. */
export const paramNow = (name: string) => new URLSearchParams(current()).get(name) ?? '';

/** Whether the entry the page is on was added by opening a panel, so Back closes it. */
export const panelEntry = () => ((window.history.state ?? {}) as Marks).panel === true;

/**
 * One value kept in the address's query (`?q=invoice`), so a narrowed view can be bookmarked and
 * survives a reload. `''` is "not set". Given `options`, the `[value, label]` pairs of the control it
 * feeds, anything else in the address counts as not set. Read as it is written, so a field that writes
 * it keeps up with typing.
 */
export function useParam<T extends string = string>(name: string, options?: readonly (readonly [T, string])[]): [T, (value: T) => void] {
  // The server draws each page once for everyone, with nothing in its query.
  const query = useSyncExternalStore(subscribe, current, () => '');
  const raw = new URLSearchParams(query).get(name) ?? '';
  const value = !options || options.some(([key]) => key === raw) ? (raw as T) : ('' as T);
  return [value, (next) => setParams({ [name]: next })];
}

/**
 * Where the page starts, once: Next.js moves the address bar only after it has drawn a screen gone to by a link, so the
 * query is read again then, and whatever was opened over the last screen (`?message=`) is gone with it.
 */
export function useQueryFollowsScreens() {
  const path = usePathname();
  useEffect(() => {
    if (wrote?.path !== path) wrote = null;
    changed();
  }, [path]);
}
