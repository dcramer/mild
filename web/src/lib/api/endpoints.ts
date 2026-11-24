import { Refused, get, post, reason, send, setSigningOut } from './client.ts';
import { queryClientFor } from './query.ts';
import { traceHeaders } from '../trace.ts';
import type {
  AddressSuggestion,
  DraftSave,
  SavedDraft,
  MessageAttachment,
  ContactPage,
  DecisionPage,
  InboxEstimate,
  MailReach,
  FactFilter,
  FeedbackReply,
  FeedbackRequest,
  Given,
  LabelProposal,
  MailAsk,
  MailChange,
  MailConversation,
  MailThreads,
  MailView,
  ManageState,
  MessageDetail,
  Models,
  Removed,
  RuleDraft,
  RuleFilter,
  RuleInbox,
  RuleMatch,
  RuleSummary,
  RuleUsage,
  RuleWaiting,
  SendRequest,
  SenderPage,
  Session,
  SignInCode,
  SuggestionDetail,
  Suggestions,
  Summary,
  SyncPage,
  Usage,
} from '../../../../src/dashboard/types.ts';

export type {
  Contact,
  ContactPage,
  InboxEstimate,
  DecisionPage,
  DecisionRow,
  FactFilter,
  FeedbackRequest,
  Given,
  LabelProposal,
  LabelSummary,
  ListedDecision,
  MailAsk,
  MailConversation,
  MailReach,
  MailThread,
  MailView,
  ManageState,
  MessageDetail,
  Removed,
  RuleDraft,
  RuleFacts,
  RuleFilter,
  RuleMatch,
  RuleSummary,
  SenderPage,
  SenderProfile,
  Session,
  StageKey,
  SuggestionDetail,
  SuggestionItem,
  Suggestions,
  Summary,
  SyncedConversation,
  SyncPage,
  Usage,
} from '../../../../src/dashboard/types.ts';
export type { Confidential } from '../../../../src/confidential.ts';

export type Days = 1 | 7 | 30 | 90;

export interface DecisionQuery {
  days: Days;
  status: string;
  search: string;
  /** Empty for none. */
  fact: FactFilter | '';
  /** A label's id; empty for any. */
  label: string;
  limit: number;
  offset: number;
}

export interface ContactQuery {
  q: string;
  /** Empty for any. */
  standing: Given | '';
  /** How they and the person know each other; empty for any. */
  know: 'new' | 'mutual' | 'one-way' | '';
  limit: number;
  offset: number;
}

/** This browser's time zone, which the server reads a person's digest hour in. */
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Sent with labels that digest: until the hour is set under Settings, it is this browser's day the digest keeps to. */
const zoneFor = (labels: readonly { disposition?: string }[]) => (labels.some((l) => l.disposition === 'digest') ? { timeZone: browserZone() } : {});

/** A rule carries a label, an action (`disposition`), or both; or an action for mail that turns out to be `whenLabel`. */
export interface RuleBody {
  match: RuleMatch;
  /** What the mail is. */
  label?: string;
  /** Apply only once Mild has said the mail is this label. */
  whenLabel?: string;
  disposition?: string;
  markRead?: boolean;
  unsubscribe?: boolean;
  when?: string;
  /** What the reader calls it; empty for none. */
  name?: string;
}

export interface MailThreadsQuery {
  view: MailView;
  label: string;
  q: string;
  unread: boolean;
  from: string;
  domain: string;
  since: number | null;
}

export const api = {
  /** With `label`, each day also says how much of its mail was that label. */
  summary: (days: Days, signal: AbortSignal, label = '') => get<Summary>('/api/summary', { days, label }, signal),
  usage: (signal: AbortSignal) => get<Usage>('/api/usage', {}, signal),
  decisions: (q: DecisionQuery, signal: AbortSignal) =>
    get<DecisionPage>(
      '/api/decisions',
      { days: q.days, status: q.status, q: q.search, fact: q.fact, label: q.label, limit: q.limit, offset: q.offset },
      signal,
    ),
  /** A message by Gmail's id, in whichever mailbox holds it; `mailbox` when the list it came from said. */
  message: (id: string, signal: AbortSignal, mailbox = '') => get<MessageDetail>('/api/message', mailbox ? { id, mailbox } : { id }, signal),
  /** One of a message's files, fetched from Gmail through Mild, to save. */
  file: async (accountId: string, messageId: string, part: string): Promise<Blob> => {
    const query = new URLSearchParams({ id: messageId, part, mailbox: accountId });
    const response = await send(`/api/message/file?${query}`, { headers: traceHeaders() }, 'Mild cannot be reached.');
    if (!response.ok) throw new Refused(response.status, await reason(response));
    return await response.blob();
  },
  /** Where a frame loads a message as the HTML Mild holds for it; `images` once the reader asked for its images, `original` for a design in its own colours. */
  messageHtml: (id: string, mailbox: string, images: boolean, original: boolean) =>
    `/api/message/html?${new URLSearchParams(images ? { id, mailbox, images: '1' } : { id, mailbox })}${original ? '#original' : ''}`,
  /** Everyone the person has mail from, newest first, a page at a time. */
  contacts: (q: ContactQuery, signal: AbortSignal) => get<ContactPage>('/api/contacts', { ...q }, signal),
  /** `name` lists only their mail under that name. */
  sender: (address: string, signal: AbortSignal, name?: string) => get<SenderPage>('/api/sender', name === undefined ? { address } : { address, name }, signal),
  domain: (domain: string, signal: AbortSignal) => get<SenderPage>('/api/domain', { domain }, signal),
  /** `theirs`: their own rule says more than a standing, so nothing was written and the rule dialog is for this. */
  giveStanding: (who: { address: string } | { domain: string }, standing: Given) =>
    post<{ id: string; was: Given | null } | { theirs: string }>('/api/standing', { ...who, standing }),
  clearStanding: (who: { address: string } | { domain: string }) => post('/api/standing/clear', who),
  rules: (signal: AbortSignal) => get<{ rules: RuleSummary[] }>('/api/rules', {}, signal),
  suggestions: (includeKept: boolean, fact: FactFilter | '', signal: AbortSignal) =>
    get<Suggestions>('/api/suggestions', { ...(includeKept ? { kept: 1 } : {}), ...(fact ? { fact } : {}) }, signal),
  suggestion: (sender: string, signal: AbortSignal) => get<SuggestionDetail>('/api/suggestion', { sender }, signal),
  /** Say what a message is. */
  feedback: (answer: FeedbackRequest) => post<FeedbackReply>('/api/feedback', answer, true),
  manage: (signal: AbortSignal) => get<ManageState>('/api/manage', {}, signal),
  /** The models the reader's own sign-ins offer, and the one to suggest first. */
  models: (signal: AbortSignal) => get<Models>('/api/models', {}, signal),
  /** The reader's own: true, Mild carries out its decisions in their Gmail. */
  setActive: (active: boolean) => post('/api/active', { active }),
  /**
   * Mail the person wrote, sent as them. Sent as the page closes too, when its toast goes then, as far as a browser lets a
   * closing page send (64 KB); a longer one waits in the draft, which Send sends once.
   */
  send: (mail: SendRequest) => post<{ id: string; threadId: string }>('/api/mail/send', mail, JSON.stringify(mail).length < 60_000),
  /** The person's drafts, whole. */
  drafts: (signal: AbortSignal) => get<{ drafts: SavedDraft[] }>('/api/mail/drafts', {}, signal),
  /** Keep what the composer holds; sent as the page closes too, while it is small enough for a closing page to send. */
  saveDraft: (draft: DraftSave) => post('/api/mail/drafts/save', draft, JSON.stringify(draft).length < 60_000),
  removeDraft: (id: string) => post('/api/mail/drafts/remove', { id }),
  /** Whom to suggest as an address is typed in the composer. */
  addresses: (q: string, signal: AbortSignal) => get<{ addresses: AddressSuggestion[] }>('/api/mail/addresses', { q }, signal),
  /** A message's files, read from Gmail once where Mild has not kept them. */
  attachments: (accountId: string, messageId: string) => post<{ attachments: MessageAttachment[] }>('/api/mail/attachments', { accountId, messageId }),
  /** Begin a file to attach; its bytes follow in pieces of at most `piece`. */
  startUpload: (file: { name: string; type: string; size: number }) => post<{ id: string; piece: number }>('/api/mail/upload', file),
  uploadPiece: (id: string, piece: number, data: string) => post('/api/mail/upload/piece', { id, piece, data }),
  removeUpload: (id: string) => post('/api/mail/upload/remove', { id }),
  /** The reader's own model, `provider/model-id`, or null for none. */
  setModel: (model: string | null) => post('/api/model', { model }),
  setReasoning: (reasoning: ManageState['model']['reasoning']) => post('/api/model/reasoning', { reasoning }),
  /** Start a ChatGPT sign-in: resolves with where to go, and by device code the code to enter there. */
  signInChatGPT: () => post<SignInCode>('/api/model/chatgpt', {}),
  /** Finish a Sign in with ChatGPT with the address the browser was sent back to. */
  finishChatGPT: (address: string) => post('/api/model/chatgpt/finish', { address }),
  saveModelKey: (provider: string, key: string) => post('/api/model/key', { provider, key }),
  signOutModel: (provider: string) => post('/api/model/signout', { provider }),
  saveLabel: (id: string, change: { name?: string; description?: string; disposition?: string; markRead?: boolean; unsubscribe?: boolean }) =>
    post('/api/labels', { id, ...change, ...zoneFor([change]) }),
  /** Remove a label, with the rules that name it. */
  removeLabel: (id: string) => post('/api/labels/remove', { id }),
  /** Add labels: by hand, or kept from what the model suggested. */
  addLabels: (labels: { name: string; description: string; disposition: string; markRead?: boolean; unsubscribe?: boolean }[]) =>
    post<{ ids: string[] }>('/api/labels/add', { labels, ...zoneFor(labels) }),
  /** Ask the model for labels from what the person wants. Its own call; it can take a minute. */
  proposeLabels: (goal: string) => post<LabelProposal>('/api/labels/propose', { goal }),
  /** The latest labels the model suggested, so a reload keeps them. */
  labelProposal: (signal: AbortSignal) => get<{ proposal: LabelProposal | null }>('/api/labels/proposal', {}, signal),
  /** Make these labels, when the person has none yet. */
  acceptLabels: (labels: { name: string; description: string; disposition: string; markRead?: boolean; unsubscribe?: boolean }[]) =>
    post<{ ids: string[] }>('/api/labels/accept', { labels, ...zoneFor(labels) }),
  /** The hour of the reader's day their digests arrive, in this browser's time zone. */
  setDigestTime: (hour: number) => post('/api/digest', { hour, timeZone: browserZone() }),
  /** The model fills in a rule from the person's words, for the rule dialog. Nothing is made. */
  draftRule: (goal: string) => post<RuleDraft>('/api/rules/draft', { goal }),
  addRule: (
    rule: RuleBody & {
      /** The proposal it was made from, which this resolves. */
      proposal?: number;
    },
  ) => post<{ id: string; replaced: boolean; filter: RuleFilter | null }>('/api/rules', rule),
  /** Change what a rule matches and says, keeping its place and its exceptions. */
  editRule: (id: string, rule: RuleBody) => post('/api/rules/edit', { id, ...rule }),
  removeRule: (id: string) => post('/api/rules/remove', { id }),
  /** Write the rule to Gmail as a filter, or take its filter out. */
  ruleFilter: (id: string, on: boolean) => post('/api/rules/filter', { id, on }),
  /** What the rule decided and Mild has not moved. */
  ruleWaiting: (id: string, signal: AbortSignal) => get<RuleWaiting>('/api/rules/waiting', { id }, signal),
  ruleUsage: (id: string, signal: AbortSignal) => get<RuleUsage>('/api/rules/usage', { id }, signal),
  /** What applying the rule to the inbox would do, from a sample read from Gmail. */
  ruleInbox: (id: string, signal: AbortSignal) => get<RuleInbox>('/api/rules/inbox', { id }, signal),
  /** Start applying the rule to the inbox, in the background. */
  applyRule: (id: string) => post('/api/rules/apply', { id }),
  /** Dismiss a proposal. A proposed rule is made with `addRule`. */
  dismissProposal: (id: number) => post('/api/proposals', { id }),
  /** `message`: what the page will not show by itself, if anything. */
  undo: (id: number) => post<{ message: string | null }>('/api/undo', { id }),
  /** Inbox's conversations, a page from `before`; empty `label`, `q`, `from` and `domain` (the last two comma-separated) narrow nothing. */
  mailThreads: (query: MailThreadsQuery, before: string, signal: AbortSignal) =>
    get<MailThreads>(
      '/api/mail/threads',
      {
        view: query.view,
        label: query.label,
        q: query.q,
        ...(query.unread ? { unread: 1 } : {}),
        from: query.from,
        domain: query.domain,
        ...(query.since === null ? {} : { since: query.since }),
        before,
      },
      signal,
    ),
  /** The model turns words into a filter on Inbox's list. `today` is the reader's, `YYYY-MM-DD`. */
  askMail: (words: string, today: string) => post<MailAsk>('/api/mail/ask', { words, today }),
  /** A conversation by Gmail's id, in whichever mailbox holds it; `mailbox` when the list it came from said. */
  mailThread: (thread: string, signal: AbortSignal, mailbox = '') =>
    get<MailConversation>('/api/mail/thread', mailbox ? { thread, mailbox } : { thread }, signal),
  /** The reader's own press on mail in their inbox. `actions`: what landed, for Undo. */
  changeMail: (change: MailChange) => post<{ actions: number[]; missed: number }>('/api/mail/change', change, true),
  /** Whether Mild keeps a copy of the person's mail, for Inbox, and how far back. */
  setMail: (on: boolean, window?: ManageState['mailWindow']) => post('/api/mail/on', window ? { on, window } : { on }),
  /** What copying the mail for each window would take, from Gmail's counts. */
  mailReach: (signal: AbortSignal) => get<MailReach>('/api/mail/reach', {}, signal),
  inboxEstimate: (reach: 'inbox' | 'recent', signal: AbortSignal) => get<InboxEstimate>('/api/inbox', { reach }, signal),
  startInbox: (reach: 'inbox' | 'recent') => post('/api/inbox/start', { reach }),
  /** Stop going through the inbox, or with `rule`, stop applying it. */
  stopInbox: (rule?: string) => post('/api/inbox/stop', rule ? { rule } : {}),
  checkNow: () => post('/api/check', {}),
  session: (signal: AbortSignal) => get<Session>('/api/session', {}, signal),
  /** What changed in the page's copy since `since`; with none, the whole copy (docs/sync.md). */
  sync: (since: string | null, signal: AbortSignal) => get<SyncPage>('/api/sync', since === null ? {} : { since }, signal),
  /** The key this browser's copy is encrypted with, where the server knows the browser (`web/src/lib/device.ts`). */
  device: (signal: AbortSignal) => get<{ key: string | null }>('/api/device', {}, signal),
  /** Make this browser a key for its copy, the first time. */
  makeDevice: () => post<{ key: string }>('/api/device', {}),
  signOut: async () => {
    setSigningOut(true);
    await queryClientFor().cancelQueries();
    try {
      await post('/api/signout', {});
    } catch (error) {
      setSigningOut(false);
      throw error;
    }
  },
  /** `address` is what the person typed to confirm. */
  removeMailbox: (address: string) => post<Removed>('/api/mailbox/remove', { address }),
  makePrimary: (address: string) => post('/api/mailbox/primary', { address }),
  deleteAccount: (address: string) => post<Removed>('/api/account/delete', { address }),
};
