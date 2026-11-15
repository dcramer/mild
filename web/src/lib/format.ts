import type { StageKey } from './api.ts';

/** Tiers in cascade order, cheapest first. Each has a fixed ink (see index.css); mail no tier decided is highlighted. */
export const TIERS: { key: StageKey; name: string; color: string }[] = [
  { key: 'rules', name: 'Rules', color: 'var(--tier-rules)' },
  { key: 'sender', name: 'Senders (before rules)', color: 'var(--tier-sender)' },
  { key: 'classifier', name: 'Decision model', color: 'var(--tier-classifier)' },
  { key: 'agent', name: 'Agent', color: 'var(--tier-agent)' },
  { key: 'fallback', name: 'Undecided', color: 'var(--tier-fallback)' },
];
export const tier = (key: string) => TIERS.find((t) => t.key === key) ?? { key, name: key, color: 'var(--muted-foreground)' };

const DISPOSITIONS: Record<string, string> = { keep: 'Kept in inbox', archive: 'Archived', spam: 'Marked spam', review: 'Left for review' };
export const dispositionName = (key: string) => DISPOSITIONS[key] ?? key;
export const DISPOSITION_KEYS = Object.keys(DISPOSITIONS);

/** What a label can be set to do, as a choice. */
export const ACTIONS = [
  ['keep', 'Keep in inbox'],
  ['archive', 'Archive'],
  ['spam', 'Mark spam'],
  ['review', 'Leave for me'],
] as const;
export type ActionKey = (typeof ACTIONS)[number][0];
const WILL: Record<string, string> = { keep: 'kept', archive: 'archived', spam: 'marked spam', review: 'left for you' };
/** What happens to mail with a given action, for the end of a sentence. */
export const willBe = (key: string) => WILL[key] ?? key;

const OUTCOMES: Record<string, string> = {
  observed: 'Observed only',
  none: 'Nothing to do',
  skipped: 'Skipped',
  done: 'Done',
  failed: 'Failed',
  unknown: 'Unconfirmed',
};
export const outcomeName = (key: string | null) => (key === null ? 'Waiting to act' : (OUTCOMES[key] ?? key));

const int = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const count = (n: number) => (n >= 10_000 ? compact.format(n) : int.format(n));
export const percent = (part: number, whole: number) => (whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`);
export const money = (usd: number) => (usd === 0 ? '$0' : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);

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
