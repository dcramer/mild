import { useCallback, useEffect, useRef, useState } from 'react';

export type {
  DecisionRow,
  FeedbackRequest,
  MessageDetail,
  RuleSummary,
  StageKey,
  SuggestionGroup,
  Suggestions,
  Summary,
} from '../../../src/dashboard/types.ts';
import type { DecisionRow, FeedbackRequest, MessageDetail, RuleSummary, Suggestions, Summary } from '../../../src/dashboard/types.ts';

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

export const api = {
  summary: (days: Days, signal: AbortSignal) => get<Summary>('/api/summary', { days }, signal),
  decisions: (q: DecisionQuery, signal: AbortSignal) =>
    get<DecisionPage>('/api/decisions', { days: q.days, stage: q.stage, disposition: q.disposition, q: q.search, limit: q.limit, offset: q.offset }, signal),
  message: (account: string, id: string, signal: AbortSignal) => get<MessageDetail>('/api/message', { account, id }, signal),
  rules: (signal: AbortSignal) => get<{ rules: RuleSummary[] }>('/api/rules', {}, signal),
  suggestions: (includeKept: boolean, signal: AbortSignal) => get<Suggestions>('/api/suggestions', includeKept ? { kept: 1 } : {}, signal),
  /** Tell sift whether a suggestion was right. Resolves with what it learned. */
  feedback: async (answer: FeedbackRequest): Promise<{ reviewed: number; taught: string | null }> => {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sift': '1' },
      body: JSON.stringify(answer),
    });
    const body = (await response.json()) as { reviewed: number; taught: string | null; error?: string };
    if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
    return body;
  },
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
