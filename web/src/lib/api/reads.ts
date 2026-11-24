import { type ContactQuery, type Days, type DecisionQuery, type FactFilter, type MailThreadsQuery, api } from './endpoints.ts';
import { keys } from './keys.ts';
import { queryClientFor, readAhead, readAheadOnRest, useLoaded, usePages } from './query.ts';

/**
 * Every read the page makes, by name, each under its key (`keys`) and how often it is read again. `mailbox` narrows a
 * read to one mailbox, `''` to none; left out, it is the `Mailbox` it is drawn under.
 */

export const useSession = (mailbox?: string) => useLoaded(keys.session, (signal) => api.session(signal), 300_000, mailbox);

/** Settings' data, which most screens draw from: read every minute, or as often as `refreshMs` where it is being changed. */
export const useManage = ({ refreshMs = 60_000, mailbox }: { refreshMs?: number; mailbox?: string } = {}) =>
  useLoaded(keys.manage, (signal) => api.manage(signal), refreshMs, mailbox);

export const useUsage = () => useLoaded(keys.usage, (signal) => api.usage(signal), 60_000);

export const useRules = () => useLoaded(keys.rules, (signal) => api.rules(signal));

export const useSuggestions = (withKept = false, fact: FactFilter | '' = '') =>
  useLoaded(keys.suggestions(withKept, fact), (signal) => api.suggestions(withKept, fact, signal));

export const useModels = (signedIn: readonly string[]) => useLoaded(keys.models(signedIn), (signal) => api.models(signal), 300_000);

/** Every mailbox's: a draft is written from any of them. */
export const useDrafts = () => useLoaded(keys.drafts, (signal) => api.drafts(signal), 60_000, '');

export const useLabelProposal = () => useLoaded(keys.labelProposal, (signal) => api.labelProposal(signal), 300_000);

/** Read from Gmail's counts, so not asked for again for a while. */
export const useMailReach = () => useLoaded(keys.mailReach, (signal) => api.mailReach(signal), 300_000);

/** What going through the newest of the inbox would take. Read from Gmail, so it is not asked for again for a while. */
export const useInboxEstimate = (reach: 'inbox' | 'recent') => useLoaded(keys.inboxEstimate(reach), (signal) => api.inboxEstimate(reach, signal), 300_000);

/** Not narrowed: a message linked to may be in a mailbox the dashboard is not narrowed to. Null `messageId` reads nothing. */
export const useMessage = (accountId: string, messageId: string | null) =>
  useLoaded(
    keys.message(accountId, messageId ?? ''),
    (signal) => (messageId === null ? Promise.resolve(null) : api.message(messageId, signal, accountId)),
    30_000,
    '',
  );

/** A message read ahead of a press that opens it: at once, or once the pointer or the keys rest on its row. */
export const readMessageAhead = (accountId: string, messageId: string, onRest = false) =>
  (onRest ? readAheadOnRest : readAhead)(keys.message(accountId, messageId), (signal) => api.message(messageId, signal, accountId));

/**
 * The top of Inbox read ahead in one call, so opening any of it waits on nothing: each message is kept as
 * `useMessage` reads it. One asked for in the last minute is not asked for again, whatever came of it.
 */
export function readScreenAhead(refs: readonly { accountId: string; messageId: string }[]): void {
  const now = Date.now();
  const client = queryClientFor();
  const due = refs.filter(({ accountId, messageId }) => {
    const key = keys.message(accountId, messageId);
    return client.getQueryData([key]) === undefined && now - (askedAt.get(key) ?? -Infinity) > 60_000;
  });
  if (due.length === 0) return;
  for (const { accountId, messageId } of due) askedAt.set(keys.message(accountId, messageId), now);
  void api
    .messagesAhead(
      due.map((ref) => ref.messageId),
      new AbortController().signal,
    )
    .then(({ messages }) => {
      for (const detail of messages) client.setQueryData([keys.message(detail.accountId, detail.messageId)], detail, { updatedAt: now });
    })
    .catch(() => {});
}
const askedAt = new Map<string, number>();

/** What Mild waits on the reader for from `sender`. */
export const useSuggestion = (sender: string) => useLoaded(keys.suggestion(sender), (signal) => api.suggestion(sender, signal), 120_000);

/** Read from Gmail, so only when asked. */
export const useRuleInbox = (id: string) => useLoaded(keys.ruleInbox(id), (signal) => api.ruleInbox(id, signal), 0);

export const useRuleWaiting = (id: string) => useLoaded(keys.ruleWaiting(id), (signal) => api.ruleWaiting(id, signal));

export const useRuleUsage = (id: string) => useLoaded(keys.ruleUsage(id), (signal) => api.ruleUsage(id, signal));

export const useContacts = (query: ContactQuery) => useLoaded(keys.contacts(query), (signal) => api.contacts(query, signal), 120_000);

export const useDecisions = (query: DecisionQuery) => useLoaded(keys.decisions(query), (signal) => api.decisions(query, signal));

export const useSummary = (days: Days, label: string) => useLoaded(keys.summary(days, label), (signal) => api.summary(days, signal, label));

type Who = { address: string } | { domain: string };
const kindOf = (who: Who) => ('address' in who ? 'sender' : 'domain');
const named = (who: Who) => ('address' in who ? who.address : who.domain);
const read = (who: Who, signal: AbortSignal) => ('address' in who ? api.sender(who.address, signal) : api.domain(who.domain, signal));

/** A sender's or a domain's card, which changes little while it is open. */
export const useWhoCard = (who: Who) => useLoaded(keys.card(kindOf(who), named(who)), (signal) => read(who, signal), 300_000);

export const useWhoPage = (who: Who) => useLoaded(keys.page(kindOf(who), named(who)), (signal) => read(who, signal));

/** A sender's mail under one of their names; a domain, or no name, reads nothing. */
export const useSenderUnder = (who: Who, name: string) =>
  useLoaded(keys.pageUnder(named(who), name), (signal) => ('address' in who && name !== '' ? api.sender(who.address, signal, name) : Promise.resolve(null)));

/** Inbox's conversations from Mild, a page at a time; `on` false reads none. `asked`: what Ask made of the search. */
export const useMailThreads = (on: boolean, query: MailThreadsQuery, asked: object) =>
  usePages(keys.mailThreads([on, query.view, query.label, query.unread, query.q, JSON.stringify(asked)]), (before, signal) =>
    on ? api.mailThreads(query, before, signal) : Promise.resolve({ threads: [], next: null }),
  );
