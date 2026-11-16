import type { StageKey } from './api.ts';

/**
 * The dashboard's words. Each thing sift says about mail has exactly one name, used in every stamp,
 * filter, select and column; sentences use the matching phrase from `willBe`. Add a word here, never in a view.
 */

/** Tiers in cascade order, cheapest first. Each has a fixed ink (see index.css); mail no tier decided is highlighted. */
export const TIERS: { key: StageKey; name: string; color: string }[] = [
  { key: 'rules', name: 'Rule', color: 'var(--tier-rules)' },
  { key: 'heuristics', name: 'Header checks', color: 'var(--tier-sender)' },
  { key: 'sender', name: 'Sender (old)', color: 'var(--tier-sender)' },
  { key: 'classifier', name: 'Model', color: 'var(--tier-classifier)' },
  { key: 'agent', name: 'Agent', color: 'var(--tier-agent)' },
  { key: 'fallback', name: 'Not sure', color: 'var(--tier-fallback)' },
];
export const tier = (key: string) => TIERS.find((t) => t.key === key) ?? { key, name: key, color: 'var(--muted-foreground)' };

/** What a label can be set to do, and so what sift does with mail. The same word whether it is suggested, done or a setting. */
export const ACTIONS = [
  ['keep', 'Keep'],
  ['archive', 'Archive'],
  ['spam', 'Spam'],
  ['block', 'Block'],
] as const;
export type ActionKey = (typeof ACTIONS)[number][0];

/** `review`: no tier was sure, so sift leaves the message alone and asks. */
const OUTCOMES: Record<string, string> = { ...Object.fromEntries(ACTIONS), review: 'Not sure' };
export const outcomeName = (key: string) => OUTCOMES[key] ?? key;
/** What a decision can be filtered by: `block` is recorded as spam. */
export const OUTCOME_KEYS = ['keep', 'archive', 'spam', 'review'] as const;

/** What a label's action does, in a sentence, so a choice says what follows from it before it is made. */
export const EXPLAIN: Record<ActionKey, string> = {
  keep: 'It stays in the inbox, with its label.',
  archive: 'It leaves the inbox and stays findable under its label.',
  spam: 'It goes to spam. Never for anyone you have written to.',
  block: 'It goes to spam, and so does everything that sender sends afterwards, without being judged again. Only when the message proves who sent it.',
};

const WILL: Record<string, string> = {
  keep: 'kept',
  archive: 'archived',
  spam: 'marked spam',
  block: 'marked spam and the sender blocked',
  review: 'left for you',
};
/** What happens to mail with a given action, for the end of a sentence. */
export const willBe = (key: string) => WILL[key] ?? key;

/** The extras a label, rule or decision carries, for after its action: "mark read, unsubscribe". */
export const extras = (of: { markRead?: boolean; unsubscribe?: boolean }) =>
  [of.markRead ? 'mark read' : null, of.unsubscribe ? 'unsubscribe' : null].filter(Boolean).join(', ');

/** Where a decision has got to in Gmail. `trouble` is the only one shown in red. */
export type Status = 'suggested' | 'waiting' | 'done' | 'unchanged' | 'undone' | 'skipped' | 'failed';
export const STATUS_NAMES: Record<Status, string> = {
  suggested: 'Suggested',
  waiting: 'Waiting',
  done: 'Done',
  unchanged: 'No change',
  undone: 'Undone',
  skipped: 'Skipped',
  failed: 'Failed',
};
export function status(d: { mode: string; outcome: string | null; actionStatus: string | null }): Status {
  if (d.mode === 'observe') return 'suggested';
  if (d.actionStatus === 'undone') return 'undone';
  if (d.outcome === null || d.actionStatus === 'pending') return 'waiting';
  if (d.outcome === 'failed' || d.outcome === 'unknown' || d.actionStatus === 'failed' || d.actionStatus === 'unknown') return 'failed';
  if (d.outcome === 'skipped') return 'skipped';
  return d.outcome === 'none' ? 'unchanged' : 'done';
}
/** What Activity can be narrowed to; the server applies the same groups. */
export const STATUS_FILTERS = [
  ['', 'Any'],
  ['suggested', 'Suggested'],
  ['done', 'Done'],
  ['undone', 'Undone'],
  ['trouble', 'Needs a look'],
] as const;

export const PERIODS = [
  ['1', 'Last 24 hours'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
] as const;

export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

const int = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const count = (n: number) => (n >= 10_000 ? compact.format(n) : int.format(n));
export const percent = (part: number, whole: number) => (whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`);
export const money = (usd: number) => (usd === 0 ? '$0' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

export const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const dateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const MATCH: Record<string, string> = {
  from: 'from',
  fromDomain: 'from anyone at',
  to: 'sent to',
  listId: 'on the list',
  subjectContains: 'with a subject containing',
};
/** A rule's conditions as words to follow "mail": "from news@example.com, with a subject containing …". */
export const describeMatch = (match: Record<string, string>) =>
  Object.entries(match)
    .map(([key, value]) => `${MATCH[key] ?? key} ${key === 'subjectContains' ? `“${value}”` : value}`)
    .join(', ');

/** Where a sender stands, in a word. */
export const STANDINGS = { trusted: 'Trusted', known: 'Known', new: 'New', unwanted: 'Unwanted', blocked: 'Blocked' } as const;
