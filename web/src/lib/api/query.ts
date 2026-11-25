import {
  CancelledError,
  type InfiniteData,
  QueryCache,
  QueryClient,
  environmentManager,
  keepPreviousData,
  onlineManager,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useContext, useSyncExternalStore } from 'react';
import { keptReads, readName } from '../kept.ts';
import { Mailbox } from '../narrowed.ts';
import { Refused, Unreachable, narrow } from './client.ts';
import { keys } from './keys.ts';

const makeClient = (): QueryClient => {
  const client = new QueryClient({
    // A session that ended elsewhere: ask who is signed in again, which shows the sign-in screen.
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof Refused && error.status === 401) void client.invalidateQueries({ queryKey: [keys.session] });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 5000,
        // Unreachable is retried for as long as it takes; a query waits, paused, while offline. Anything Mild answered will not change by asking again.
        retry: (_, error) => error instanceof Unreachable,
      },
    },
  });
  return client;
};

let browserClient: QueryClient | undefined;

/**
 * Where what the page loaded is kept. The browser keeps one for as long as the page is open. The server never fetches:
 * it makes an empty one for each page it draws.
 */
export const queryClientFor = (): QueryClient => (environmentManager.isServer() ? makeClient() : (browserClient ??= makeClient()));

/** False while Mild cannot be reached. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (changed) => onlineManager.subscribe(changed),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** What this device last kept of a read, drawn while Mild is asked: out of date, so it always is. */
const kept = <T>(queryKey: readonly unknown[]) => ({
  initialData: () => keptReads.get(readName(queryKey))?.value as T | undefined,
  initialDataUpdatedAt: 0,
});

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** The settings a deploy still needs, when that is why it failed. */
  missing: string[] | null;
  /** Load again now. */
  reload: () => void;
  /** True only before the first result; refreshes keep showing the previous data. */
  loading: boolean;
  /** When `data` was read. */
  at: number;
  /** The data at once when there is some, else once the read on its way brings it. */
  ready: () => Promise<T>;
}

/**
 * Load `fetcher` now, again whenever `key` changes, every `refreshMs` while the tab is visible, when the
 * tab is returned to and when Mild comes back after being unreachable. Views that share a `key` share
 * one request. A failed refresh keeps the last good data on screen and reports the error beside it.
 * Narrowed to the `Mailbox` it is drawn under, or to `mailbox` (`''` for all of them), and loaded again for another.
 */
export function useLoaded<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, refreshMs = 30_000, mailbox?: string): Loaded<T> {
  const under = useContext(Mailbox);
  const narrowed = mailbox ?? under;
  const client = useQueryClient();
  // All mailboxes is the key alone, as the device keeps the frame under it (`web/src/lib/device.ts`).
  const queryKey = narrowed ? [key, narrowed] : [key];
  const queryFn = ({ signal }: { signal: AbortSignal }) => {
    if (narrowed) narrow(signal, narrowed);
    return fetcher(signal);
  };
  const query = useQuery({
    queryKey,
    ...kept<T>(queryKey),
    queryFn,
    refetchInterval: refreshMs,
    placeholderData: keepPreviousData,
  });
  return {
    data: query.data ?? null,
    error: query.error?.message ?? null,
    missing: query.error instanceof Refused ? query.error.missing : null,
    loading: query.isPending,
    at: query.dataUpdatedAt,
    reload: () => void query.refetch({ cancelRefetch: false }),
    ready: () => {
      // What the device kept (`kept`, dated 0) may be out of date: wait for Mild's.
      const read = () => client.query({ queryKey, queryFn, staleTime: (q) => (q.state.dataUpdatedAt === 0 ? 0 : Infinity) });
      // The read on its way is stopped if what drew it goes (a panel closed by the press that asked): read it again.
      return read().catch((error: unknown) => (error instanceof CancelledError ? read() : Promise.reject(error)));
    },
  };
}

/** Read what `useLoaded(key, …, '')` will draw ahead of a press that draws it, unless it was read in the last minute. */
export function readAhead<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>): void {
  queryClientFor()
    // `ahead`: nobody is waiting on it, so the loading bar does not count it.
    .query({ queryKey: [key], queryFn: ({ signal }) => fetcher(signal), staleTime: 60_000, meta: { ahead: true } })
    .catch(() => {});
}

/** How long the pointer, or the keys, rest on a row before what it opens is read ahead: passing over rows reads nothing. */
const REST_MS = 200;
let resting: ReturnType<typeof setTimeout> | null = null;
let restedOn: string | null = null;

/**
 * `readAhead` for the row the pointer or the keys are on, once they rest there, one row at a time: moving to another
 * first lets go of this one, and stops its read while nothing shows it yet. Each read is a call to the server, which a
 * sweep down the list would otherwise make once a row and put ahead of the one pressed.
 */
export function readAheadOnRest<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>): void {
  if (resting) clearTimeout(resting);
  const left = restedOn;
  if (left !== null && left !== key)
    void queryClientFor().cancelQueries({ queryKey: [left], predicate: (query) => query.getObserversCount() === 0 && query.state.data === undefined });
  restedOn = key;
  resting = setTimeout(() => {
    resting = null;
    readAhead(key, fetcher);
  }, REST_MS);
}

/**
 * Change what `useLoaded(key, …, '')` holds now, for a change this page made and knows the result of, so a view drawn
 * from it before it is read again (a conversation opened again straight after it was read) is not drawn from the old.
 */
export function changeLoaded<T>(key: string, change: (old: T) => T) {
  queryClientFor().setQueryData<T>([key], (old) => (old === undefined ? old : change(old)));
}

export interface Pages<T> {
  pages: T[];
  error: string | null;
  loading: boolean;
  /** There is more after the last page. */
  more: boolean;
  /** Load the page after the last, unless one is already on its way. */
  next: () => void;
}

/**
 * A list read a page at a time, as `useLoaded` reads one: each page from where the last ended (`next` in its reply, null
 * at the end). Read again, every page loaded so far is.
 */
export function usePages<T extends { next: string | null }>(
  key: string,
  fetcher: (before: string, signal: AbortSignal) => Promise<T>,
  refreshMs = 60_000,
): Pages<T> {
  const narrowed = useContext(Mailbox);
  const queryKey = narrowed ? [key, narrowed] : [key];
  const query = useInfiniteQuery({
    queryKey,
    ...kept<InfiniteData<T, string>>(queryKey),
    queryFn: ({ pageParam, signal }) => {
      if (narrowed) narrow(signal, narrowed);
      return fetcher(pageParam, signal);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: refreshMs,
    placeholderData: keepPreviousData,
  });
  return {
    pages: query.data?.pages ?? [],
    error: query.error?.message ?? null,
    loading: query.isPending,
    more: query.hasNextPage,
    next: () => {
      if (!query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}
