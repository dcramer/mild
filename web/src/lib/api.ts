import { QueryCache, QueryClient, keepPreviousData, onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';

export type {
  ChangeRow,
  DecisionRow,
  FeedbackRequest,
  LabelSummary,
  ManageState,
  MessageDetail,
  RuleSummary,
  SenderProfile,
  Session,
  StageKey,
  SuggestionDetail,
  SuggestionGroup,
  Suggestions,
  Summary,
} from '../../../src/dashboard/types.ts';
import type {
  ChangeRow,
  DecisionRow,
  FeedbackRequest,
  ManageState,
  MessageDetail,
  RuleSummary,
  Session,
  SuggestionDetail,
  Suggestions,
  Summary,
} from '../../../src/dashboard/types.ts';

export type Days = 1 | 7 | 30 | 90;

export interface DecisionPage {
  total: number;
  rows: DecisionRow[];
}

export interface DecisionQuery {
  days: Days;
  stage: string;
  disposition: string;
  search: string;
  limit: number;
  offset: number;
}

/** The server answered, and refused. */
class Refused extends Error {
  status: number;
  constructor(status: number, message?: string) {
    super(message ?? `The server answered ${status}.`);
    this.status = status;
  }
}

/** No answer at all: the network is down or sift is not running. */
class Unreachable extends Error {}

let probing = false;

/**
 * Marks sift unreachable, which pauses every query where it is with what it last loaded, and asks
 * again until something answers. Coming back online resumes the paused queries and refreshes the rest.
 */
function lost() {
  onlineManager.setOnline(false);
  if (probing) return;
  probing = true;
  const ask = (wait: number) =>
    setTimeout(() => {
      fetch('/api/session', { cache: 'no-store' }).then(
        () => {
          probing = false;
          onlineManager.setOnline(true);
        },
        () => ask(Math.min(wait * 2, 30_000)),
      );
    }, wait);
  ask(2000);
}

async function send(path: string, init: RequestInit, unreachable: string): Promise<Response> {
  try {
    const response = await fetch(path, init);
    onlineManager.setOnline(true);
    return response;
  } catch (error) {
    if (init.signal?.aborted) throw error;
    lost();
    throw new Unreachable(unreachable, { cause: error });
  }
}

async function get<T>(path: string, params: Record<string, string | number>, signal: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== '') query.set(key, String(value));
  const response = await send(`${path}?${query}`, { signal }, 'sift cannot be reached.');
  if (!response.ok) throw new Refused(response.status);
  return (await response.json()) as T;
}

/**
 * A change. The headers mark it as coming from this page, which the server requires of every write.
 * Refused outright while sift is unreachable: a change is never queued to happen later, unseen.
 */
async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  if (!onlineManager.isOnline()) throw new Unreachable('sift cannot be reached, so nothing was changed. Try again when it is back.');
  const response = await send(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-sift': '1' }, body: JSON.stringify(body) },
    'sift stopped answering, so this may not have been saved. Check when it is back.',
  );
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Refused(response.status, result.error);
  return result;
}

export const api = {
  summary: (days: Days, signal: AbortSignal) => get<Summary>('/api/summary', { days }, signal),
  decisions: (q: DecisionQuery, signal: AbortSignal) =>
    get<DecisionPage>('/api/decisions', { days: q.days, stage: q.stage, disposition: q.disposition, q: q.search, limit: q.limit, offset: q.offset }, signal),
  message: (account: string, id: string, signal: AbortSignal) => get<MessageDetail>('/api/message', { account, id }, signal),
  rules: (signal: AbortSignal) => get<{ rules: RuleSummary[] }>('/api/rules', {}, signal),
  suggestions: (includeKept: boolean, signal: AbortSignal) => get<Suggestions>('/api/suggestions', includeKept ? { kept: 1 } : {}, signal),
  suggestion: (account: string, sender: string, signal: AbortSignal) => get<SuggestionDetail>('/api/suggestion', { account, sender }, signal),
  /**
   * Say what a message is. Resolves with what sift learned and, when the message had already been acted on,
   * what was done about that in Gmail.
   */
  feedback: (answer: FeedbackRequest) =>
    post<{ reviewed: number; taught: string | null; corrected: string | null; fixed: string | null }>('/api/feedback', answer),
  manage: (signal: AbortSignal) => get<ManageState>('/api/manage', {}, signal),
  models: (signal: AbortSignal) => get<{ models: string[]; error?: string }>('/api/models', {}, signal),
  changes: (signal: AbortSignal) => get<{ changes: ChangeRow[] }>('/api/changes', {}, signal),
  saveSettings: (change: { act?: boolean; interval?: number; model?: string | null }) => post('/api/settings', change),
  saveGuidelines: (text: string) => post('/api/guidelines', { text }),
  saveLabel: (
    accountId: string,
    id: string,
    change: { name?: string; description?: string; disposition?: string; markRead?: boolean; unsubscribe?: boolean },
  ) => post('/api/labels', { accountId, id, ...change }),
  addLabel: (label: { accountId: string; name: string; description: string; disposition: string; markRead?: boolean; unsubscribe?: boolean }) =>
    post<{ id: string }>('/api/labels/add', label),
  /** `label` is what the mail is; `disposition` an exception to that label's action. */
  addRule: (rule: { accountId: string; match: Record<string, string>; label: string; disposition?: string; markRead?: boolean; unsubscribe?: boolean }) =>
    post('/api/rules', rule),
  removeRule: (id: string) => post('/api/rules/remove', { id }),
  undo: (id: number) => post<{ message: string }>('/api/undo', { id }),
  backfill: (days: number) => post<{ added: number }>('/api/backfill', { days }),
  checkNow: () => post('/api/check', {}),
  session: (signal: AbortSignal) => get<Session>('/api/session', {}, signal),
  signOut: () => post('/api/signout', {}),
};

export const queryClient = new QueryClient({
  // A session that ended elsewhere: ask who is signed in again, which shows the sign-in screen.
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof Refused && error.status === 401) void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5000,
      // Unreachable is retried for as long as it takes; a query waits, paused, while offline. A refusal will not change by asking again.
      retry: (failures, error) => error instanceof Unreachable || (error instanceof Refused && error.status >= 500 && failures < 3),
    },
  },
});

/** False while sift cannot be reached. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (changed) => onlineManager.subscribe(changed),
    () => onlineManager.isOnline(),
  );
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** Load again now. */
  reload: () => void;
  /** True only before the first result; refreshes keep showing the previous data. */
  loading: boolean;
}

/**
 * Load `fetcher` now, again whenever `key` changes, every `refreshMs` while the tab is visible, when the
 * tab is returned to and when sift comes back after being unreachable. Views that share a `key` share
 * one request. A failed refresh keeps the last good data on screen and reports the error beside it.
 */
export function useLoaded<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, refreshMs = 30_000): Loaded<T> {
  const query = useQuery({ queryKey: [key], queryFn: ({ signal }) => fetcher(signal), refetchInterval: refreshMs, placeholderData: keepPreviousData });
  return {
    data: query.data ?? null,
    error: query.error?.message ?? null,
    loading: query.isPending,
    reload: () => void query.refetch({ cancelRefetch: false }),
  };
}

/** Run a change, tracking whether it is in flight and what went wrong. When it is done, everything on screen loads again. */
export function useAction(): { busy: boolean; error: string | null; run: (work: () => Promise<unknown>, then?: () => void) => void } {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    run: (work, then) => {
      setBusy(true);
      setError(null);
      work()
        .then(() => {
          // Not the model list: it comes from the provider, and no change here alters it.
          void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'models' });
          then?.();
        })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
        .finally(() => setBusy(false));
    },
  };
}
