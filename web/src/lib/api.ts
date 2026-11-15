import { useCallback, useEffect, useRef, useState } from 'react';

export type {
  ChangeRow,
  DecisionRow,
  FeedbackRequest,
  LabelSummary,
  ManageState,
  MessageDetail,
  RuleSummary,
  Session,
  StageKey,
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

async function get<T>(path: string, params: Record<string, string | number>, signal: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== '') query.set(key, String(value));
  const response = await fetch(`${path}?${query}`, { signal });
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  return (await response.json()) as T;
}

/** A change. The headers mark it as coming from this page, which the server requires of every write. */
async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sift': '1' }, body: JSON.stringify(body) });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `The server answered ${response.status}.`);
  return result;
}

export const api = {
  summary: (days: Days, signal: AbortSignal) => get<Summary>('/api/summary', { days }, signal),
  decisions: (q: DecisionQuery, signal: AbortSignal) =>
    get<DecisionPage>('/api/decisions', { days: q.days, stage: q.stage, disposition: q.disposition, q: q.search, limit: q.limit, offset: q.offset }, signal),
  message: (account: string, id: string, signal: AbortSignal) => get<MessageDetail>('/api/message', { account, id }, signal),
  rules: (signal: AbortSignal) => get<{ rules: RuleSummary[] }>('/api/rules', {}, signal),
  suggestions: (includeKept: boolean, signal: AbortSignal) => get<Suggestions>('/api/suggestions', includeKept ? { kept: 1 } : {}, signal),
  /** Tell sift whether a suggestion was right. Resolves with what it learned. */
  feedback: (answer: FeedbackRequest) => post<{ reviewed: number; taught: string | null }>('/api/feedback', answer),
  manage: (signal: AbortSignal) => get<ManageState>('/api/manage', {}, signal),
  models: (signal: AbortSignal) => get<{ models: string[]; error?: string }>('/api/models', {}, signal),
  changes: (signal: AbortSignal) => get<{ changes: ChangeRow[] }>('/api/changes', {}, signal),
  saveSettings: (change: { act?: boolean; interval?: number; model?: string | null }) => post('/api/settings', change),
  saveGuidelines: (text: string) => post('/api/guidelines', { text }),
  saveLabel: (accountId: string, id: string, change: { name?: string; description?: string; disposition?: string }) =>
    post('/api/labels', { accountId, id, ...change }),
  addLabel: (label: { accountId: string; name: string; description: string; disposition: string }) => post<{ id: string }>('/api/labels/add', label),
  /** `label` is what the mail is; `disposition` an exception to that label's action. */
  addRule: (rule: { accountId: string; match: Record<string, string>; label: string; disposition?: string }) => post('/api/rules', rule),
  removeRule: (id: string) => post('/api/rules/remove', { id }),
  undo: (id: number) => post<{ message: string }>('/api/undo', { id }),
  backfill: (days: number) => post<{ added: number }>('/api/backfill', { days }),
  checkNow: () => post('/api/check', {}),
  session: (signal: AbortSignal) => get<Session>('/api/session', {}, signal),
  signOut: () => post('/api/signout', {}),
};

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** Load again now. */
  reload: () => void;
  /** True only before the first result; refreshes keep showing the previous data. */
  loading: boolean;
}

/**
 * Load `fetcher` now, again whenever `key` changes, and every `refreshMs` while the tab is visible.
 * A failed refresh keeps the last good data on screen and reports the error beside it.
 */
export function useLoaded<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, refreshMs = 30_000): Loaded<T> {
  const [state, setState] = useState<Omit<Loaded<T>, 'reload'>>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(fetcher);
  latest.current = fetcher;

  const load = useCallback((signal: AbortSignal) => {
    latest
      .current(signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setState((previous) => ({ data: previous.data, error: error instanceof Error ? error.message : String(error), loading: false }));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) load(controller.signal);
    }, refreshMs);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [key, load, refreshMs, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Run a change, tracking whether it is in flight and what went wrong. */
export function useAction(): { busy: boolean; error: string | null; run: (work: () => Promise<unknown>, then?: () => void) => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    run: (work, then) => {
      setBusy(true);
      setError(null);
      work()
        .then(() => then?.())
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
        .finally(() => setBusy(false));
    },
  };
}
