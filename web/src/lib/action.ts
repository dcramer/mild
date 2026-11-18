'use client';
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '@/system';

interface Change {
  work: () => Promise<unknown>;
  /** The rows it takes off the page while it is on its way. */
  hides: readonly string[];
  /** When its work was done, which what is read after it already shows. */
  done?: number;
}

const CHANGE = ['change'];

/**
 * Run a change, tracking whether it is in flight and what went wrong. When it is done, everything on screen loads again.
 * `hide` is for a change that takes rows off a list (an answer, a dismissal): they go at once, rather than after the
 * save and the reload behind it, and come back if it fails, with the failure in a toast, since the row that would
 * have shown it is gone.
 */
export function useAction(): {
  busy: boolean;
  error: string | null;
  run: (work: () => Promise<unknown>, then?: () => void) => void;
  hide: (keys: readonly string[], failed: string, work: () => Promise<unknown>) => void;
} {
  const client = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  // Not the model list: it comes from the provider, and is asked for again when a sign-in changes (its key names them).
  const reload = () => client.invalidateQueries({ predicate: (query) => !String(query.queryKey[0]).startsWith('models ') });
  const change = useMutation({
    mutationKey: CHANGE,
    mutationFn: async (change: Change) => {
      await change.work();
      change.done = Date.now();
    },
    // A change that hid rows is done only once the lists have loaded without them, so they do not flash back meanwhile.
    onSuccess: (_, { hides }) => (hides.length > 0 ? reload() : void reload()),
    // Several messages answered together may have been saved in part.
    onError: (_, { hides }) => void (hides.length > 0 && reload()),
    // Unreachable fails the change, which says it may not have been saved, rather than holding it, hidden, until Sift is back.
    networkMode: 'always',
  });
  const said = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));
  return {
    busy: change.isPending,
    error,
    run: (work, then) => {
      setError(null);
      change.mutateAsync({ work, hides: [] }).then(
        () => then?.(),
        (failure: unknown) => setError(said(failure)),
      );
    },
    hide: (keys, failed, work) => {
      change.mutateAsync({ work, hides: keys }).catch((failure: unknown) => toast(failed, { tone: 'failure', description: said(failure) }));
    },
  };
}

/**
 * The rows `hide` has taken off the page, which every list it names them in leaves out. Given when a count was read
 * (`asOf`), only those whose change it does not already show, so a count can take them off too.
 */
export function useHidden(asOf?: number): ReadonlySet<string> {
  const hidden = useMutationState({
    filters: { mutationKey: CHANGE, status: 'pending' },
    select: (mutation) => mutation.state.variables as Change | undefined,
  });
  return new Set(hidden.flatMap((c) => (c && (asOf === undefined || c.done === undefined || c.done > asOf) ? c.hides : [])));
}
