import type { FactFilter } from './endpoints.ts';

/**
 * The name each read is kept under, which reads with the same name share. The frame's are kept on the device by these
 * names too (`web/src/lib/device.ts`), so renaming one drops what a device kept under it.
 */
export const keys = {
  session: 'session',
  manage: 'manage',
  usage: 'usage',
  rules: 'rules',
  drafts: 'drafts',
  labelProposal: 'labelProposal',
  mailReach: 'mail-reach',
  /** For review's list, and the rules Mild proposes, which Inbox draws above its rows: `suggestions(false, '')`. */
  suggestions: (withKept: boolean, fact: FactFilter | '') => `suggestions-${withKept}${fact ? `-${fact}` : ''}`,
  /** Named by the sign-ins the list comes from, so it is read again when they change. */
  models: (signedIn: readonly string[]) => `${MODELS}${signedIn.join(' ')}`,
  inboxEstimate: (reach: string) => `inbox-${reach}`,
  message: (accountId: string, messageId: string) => `message/${accountId}/${messageId}`,
  thread: (accountId: string, threadId: string) => `thread/${accountId}/${threadId}`,
  suggestion: (sender: string) => `suggestion/${sender}`,
  ruleInbox: (id: string) => `rule-inbox ${id}`,
  ruleWaiting: (id: string) => `rule-waiting ${id}`,
  ruleUsage: (id: string) => `rule-usage ${id}`,
  contacts: (query: object) => `contacts-${JSON.stringify(query)}`,
  decisions: (query: object) => `decisions-${JSON.stringify(query)}`,
  summary: (days: number, label: string) => `summary-${days}-${label}`,
  /** A sender's or a domain's card, where the pointer rests on them. */
  card: (kind: 'sender' | 'domain', who: string) => `${kind}-${who}`,
  page: (kind: 'sender' | 'domain', who: string) => `${kind}-page-${who}`,
  /** A sender's page narrowed to their mail under one name. */
  pageUnder: (address: string, name: string) => `sender-page-${address}-under-${name}`,
  mailThreads: (parts: readonly unknown[]) => [MAIL_THREADS, ...parts].join('-'),
};

const MODELS = 'models ';
const MAIL_THREADS = 'mail-threads';

/** The model list comes from the provider, not Mild, so a change made here leaves it. */
export const isModels = (key: unknown) => String(key).startsWith(MODELS);
export const isMailThreads = (key: unknown) => String(key).startsWith(MAIL_THREADS);
