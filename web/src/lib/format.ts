import type { StageKey } from './api.ts';

/**
 * The dashboard's words. Each thing sift says about mail has exactly one name, used in every stamp,
 * filter, select and column; sentences use the matching phrase from `willBe`. Add a word here, never in a view.
 */

/** Tiers in cascade order, cheapest first. Each has a fixed ink (see index.css); mail no tier decided is highlighted. */
export const TIERS: { key: StageKey; name: string; color: string }[] = [
  { key: 'rules', name: 'Rule', color: 'var(--tier-rules)' },
  { key: 'classifier', name: 'Classifier', color: 'var(--tier-classifier)' },
  { key: 'model', name: 'Model', color: 'var(--tier-model)' },
  { key: 'fallback', name: 'Undecided', color: 'var(--tier-fallback)' },
];
/** What became of the mail sift handled in a day, for Activity's chart, bottom to top. */
export const HANDLED = [
  { key: 'changed', name: 'Changed in Gmail', color: 'var(--handled-changed)' },
  { key: 'left', name: 'Left alone', color: 'var(--handled-left)' },
  { key: 'failed', name: 'Failed', color: 'var(--destructive)' },
];
export const tier = (key: string) => TIERS.find((t) => t.key === key) ?? { key, name: key, color: 'var(--muted-foreground)' };

/**
 * How sure sift is of a label, in three steps for a meter. A rule decided it, so it is sure; a model says how sure it was. Thresholds are a first guess until real mail calibrates them.
 */
export function sureness(stage: string, confidence: number | null): 1 | 2 | 3 {
  if (stage === 'rules') return 3;
  if (confidence === null) return 2;
  return confidence >= 0.9 ? 3 : confidence >= 0.7 ? 2 : 1;
}

/** What a label can be set to do, and so what sift does with mail. The same word whether it is suggested, done or a setting. */
export const ACTIONS = [
  ['keep', 'Keep'],
  ['archive', 'Archive'],
  ['spam', 'Spam'],
  ['block', 'Block'],
] as const;
export type ActionKey = (typeof ACTIONS)[number][0];

/** `review`: no tier was sure, so sift leaves the message alone and asks. */
const OUTCOMES: Record<string, string> = { ...Object.fromEntries(ACTIONS), review: 'No label yet' };
export const outcomeName = (key: string) => OUTCOMES[key] ?? key;

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
export function status(d: { carryOut: boolean; outcome: string | null; actionStatus: string | null }): Status {
  if (!d.carryOut) return 'suggested';
  if (d.actionStatus === 'undone') return 'undone';
  if (d.outcome === null || d.actionStatus === 'pending') return 'waiting';
  if (d.outcome === 'failed' || d.outcome === 'unknown' || d.actionStatus === 'failed' || d.actionStatus === 'unknown') return 'failed';
  if (d.outcome === 'skipped') return 'skipped';
  return d.outcome === 'none' ? 'unchanged' : 'done';
}

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
/** A round amount on an axis, which may be under a cent: $0.025. */
export const moneyTick = (usd: number) => (usd === 0 ? '$0' : `$${usd >= 0.1 ? usd.toFixed(2) : Number(usd.toPrecision(2))}`);

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

const DID: Record<string, string> = { archive: 'Archived', spam: 'Marked spam', block: 'Blocked', keep: 'Kept' };
const DOING: Record<string, string> = { archive: 'archive', spam: 'mark spam', block: 'block', keep: 'keep' };
/**
 * What happened to a message, as a log says it: "Archived", "Archive failed", "Waiting to archive". `tone`
 * says how to show it: a failure is red, an undone change is struck through, the rest are plain.
 */
export function happened(d: { carryOut: boolean; outcome: string | null; actionStatus: string | null; disposition: string }): {
  text: string;
  tone: 'plain' | 'failed' | 'undone' | 'quiet';
} {
  const s = status(d);
  const doing = DOING[d.disposition];
  if (d.disposition === 'review') return { text: outcomeName('review'), tone: 'quiet' };
  if (s === 'failed') return { text: `${capitalised(doing ?? d.disposition)} failed`, tone: 'failed' };
  if (s === 'undone') return { text: DID[d.disposition] ?? d.disposition, tone: 'undone' };
  if (s === 'waiting') return { text: `Waiting to ${doing ?? d.disposition}`, tone: 'quiet' };
  if (s === 'suggested') return { text: `Would ${doing ?? d.disposition}`, tone: 'quiet' };
  if (s === 'skipped') return { text: 'Skipped', tone: 'quiet' };
  return { text: DID[d.disposition] ?? d.disposition, tone: 'plain' };
}
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A day in the log: "Today", "Yesterday", else "Thu, Nov 12". */
export function dayName(ms: number, now: number = Date.now()): string {
  const start = (at: number) => {
    const d = new Date(at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const back = Math.round((start(now) - start(ms)) / 86_400_000);
  if (back === 0) return 'Today';
  if (back === 1) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
