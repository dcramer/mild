import { useCallback, useEffect, useRef, useState } from 'react';

export type { DecisionRow, MessageDetail, RuleSummary, StageKey, Summary } from '../../../src/dashboard/types.ts';
import type { DecisionRow, MessageDetail, RuleSummary, Summary } from '../../../src/dashboard/types.ts';

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
};

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** True only before the first result; refreshes keep showing the previous data. */
  loading: boolean;
}

/**
 * Load `fetcher` now, again whenever `key` changes, and every `refreshMs` while the tab is visible.
 * A failed refresh keeps the last good data on screen and reports the error beside it.
 */
export function useLoaded<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, refreshMs = 30_000): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: true });
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
  }, [key, load, refreshMs]);

  return state;
}
