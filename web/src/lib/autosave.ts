import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { From } from './answering.ts';
import { ofWhat } from './answering.ts';
import { api } from './api/endpoints.ts';
import { keys } from './api/keys.ts';
import { type Draft, type Writing, draftId, keepDraft, keptDraft } from './compose.ts';

/** A pause in writing long enough to save the draft to Mild, which gives it to Gmail only once the writing has stopped. */
const SAVE_PAUSE_MS = 1500;

/** The drafts read again, after a change to one: only they, since a draft is saved each time the writing pauses. */
export const reloadDrafts = (client: QueryClient) => client.invalidateQueries({ queryKey: [keys.drafts] });

/**
 * The draft the composer holds for `what`, kept in this browser as it changes (`change`) and saved to Mild once the
 * writing pauses and as the composer closes, never once it is `finished` (sent or discarded). `saved` is Mild's copy,
 * taken when newer; `forget` takes it from Mild and Gmail's Drafts, and `held` says whether Mild may have one.
 */
export function useAutosave(
  who: string,
  what: Writing,
  saved: { draft: Draft; sendAt: number | null; sendError: string | null } | null,
  start: Draft,
  choices: readonly From[],
  empty: (draft: Draft) => boolean,
) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(() => keptDraft(who, what, saved?.draft ?? null) ?? start);
  // Mild's copy, come since it opened: the newer is kept, as it was as it opened.
  const [offered, setOffered] = useState(saved?.draft.at ?? 0);
  if (saved && saved.draft.at !== offered) {
    setOffered(saved.draft.at);
    if (saved.draft.at > draft.at) setDraft(saved.draft);
  }
  // Said over the draft until it changes, which makes it a draft again, as in Gmail.
  const scheduled = saved !== null && draft.at <= saved.draft.at ? saved : null;
  // Saved to Mild once the writing pauses, and as the composer closes; never once it is sent or discarded.
  const saving = useRef<{ timer: ReturnType<typeof setTimeout> | null; latest: Draft | null; done: boolean; stored: boolean }>({
    timer: null,
    latest: null,
    done: false,
    stored: false,
  });
  const held = () => saved !== null || saving.current.stored;
  const forget = () => {
    saving.current.stored = false;
    void api.removeDraft(draftId(what)).then(
      () => reloadDrafts(client),
      () => {},
    );
  };
  const save = () => {
    const { latest, done } = saving.current;
    if (saving.current.timer) clearTimeout(saving.current.timer);
    saving.current.timer = null;
    saving.current.latest = null;
    if (!latest || done) return;
    if (empty(latest)) {
      if (held()) forget();
      return;
    }
    saving.current.stored = true;
    const account = choices.find((c) => c.address === latest.from) ?? choices[0];
    void api
      .saveDraft({
        id: draftId(what),
        accountId: account.accountId,
        writing: { ...latest, of: ofWhat(what) },
      })
      .then(
        () => reloadDrafts(client),
        () => {},
      );
  };
  const flush = useRef(save);
  useLayoutEffect(() => {
    flush.current = save;
  });
  useEffect(() => () => flush.current(), []);
  const finished = () => {
    if (saving.current.timer) clearTimeout(saving.current.timer);
    saving.current = { ...saving.current, timer: null, latest: null, done: true };
  };
  const change = (next: Partial<Draft> | ((was: Draft) => Partial<Draft>)) => {
    setDraft((was) => {
      const asked = typeof next === 'function' ? next(was) : next;
      // A changed draft is mail of its own: a try before the change may have gone, and must not be found and called this one.
      const changed = { ...was, ...('id' in asked ? {} : { id: null }), ...asked, at: Date.now() };
      keepDraft(who, what, empty(changed) ? null : changed);
      return changed;
    });
  };
  // Each change, once the writing pauses.
  useEffect(() => {
    if (draft.at === 0 || saving.current.done) return;
    saving.current.latest = draft;
    if (saving.current.timer) clearTimeout(saving.current.timer);
    saving.current.timer = setTimeout(() => flush.current(), SAVE_PAUSE_MS);
  }, [draft]);
  return { draft, change, scheduled, finished, forget, held };
}
