import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { useStarted } from '@/system/started.ts';

/** A message as a list's rows name it (`holds`), which is how the panel finds its way back to one. */
export const messageKey = (m: { accountId: string; messageId: string }) => `${m.accountId}/${m.messageId}`;

const PROPOSAL = 'proposal/';

/** A proposal as For review's list names it, for hiding it while its dismissal is on its way. */
export const proposalKey = (p: { id: number }) => `${PROPOSAL}${p.id}`;

const THREAD = 'thread/';

/** A conversation as Inbox's list names it, for hiding it while its archive is on its way. */
export const threadKey = (t: { accountId: string; threadId: string }) => `${THREAD}${t.accountId}/${t.threadId}`;

export const isMessageKey = (key: string) => !key.startsWith(PROPOSAL) && !key.startsWith(THREAD);

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
export function goToQuery(query: string, push?: { state: Marks | null }, path = window.location.pathname) {
  const to = path + (query ? `?${query}` : '');
  wrote = { path, query };
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

/**
 * The item a list has open, held in the path after the list's own (`/rules/<id>`), so it can be linked to; `''` for
 * none. Opening another, or closing it, rewrites the address in place, with `changes` to its query. The server draws the
 * list once for every item (next.config.js), so the path is read only once the page has started.
 */
export function useOpened(list: 'rules' | 'labels'): [string, (id: string, changes?: Record<string, string>) => void] {
  const path = usePathname();
  const [, at, id] = (useStarted() ? path : '').split('/');
  return [at === list && id ? decodeURIComponent(id) : '', (next, changes = {}) => openIn(list, next, changes)];
}

/** `/<list>/<id>` (or the list alone), keeping the query but for `changes`, in place of the current entry. */
function openIn(list: string, id: string, changes: Record<string, string>) {
  const query = new URLSearchParams(current());
  for (const [name, value] of Object.entries(changes)) {
    if (value === '') query.delete(name);
    else query.set(name, value);
  }
  goToQuery(query.toString(), undefined, id ? `/${list}/${encodeURIComponent(id)}` : `/${list}`);
}

/** A rule's own address, its panel over the Rules list; `apply` opens what applying it to the inbox would do. */
export const rulePath = (id: string, apply = false) => `/rules/${encodeURIComponent(id)}${apply ? '?apply=1' : ''}`;

/** Opens a rule at its address from anywhere: in place on the Rules list, else by going there, so Back returns. */
export function useOpenRule(): (id: string, apply?: boolean) => void {
  const router = useRouter();
  return (id, apply = false) => {
    if (window.location.pathname.split('/')[1] === 'rules') openIn('rules', id, { apply: apply ? '1' : '' });
    else router.push(rulePath(id, apply));
  };
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

/** The path and query the page is on, for a sign-in to come back to: `/` on the server, which draws no query. */
export function useHere(): string {
  const path = usePathname();
  const query = useSyncExternalStore(subscribe, current, () => '');
  return path + (query ? `?${query}` : '');
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
