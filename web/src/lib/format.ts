import type { FactFilter, RuleFacts, RuleMatch, StageKey } from './api.ts';

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
 * How sure sift is of a label, in three steps for a meter. Full means Sift does it by itself while it is on,
 * which for a model's label alone takes 0.9 (`SURE`, src/triage/stages/model.ts). Mail it would ask about is
 * never full, however sure the model was.
 */
export function sureness({ confidence, disposition }: { confidence: number | null; disposition: string }): 1 | 2 | 3 {
  if (disposition !== 'review') return 3;
  return confidence !== null && confidence >= 0.7 ? 2 : 1;
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

export const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What a rule can ask of what sift recorded about a message, each answer with its words after "mail that".
 * The same answers and words as `RULE_FACTS` (src/triage/facts.ts); tests/facts.test.ts holds them together.
 */
export const FACTS = {
  unsubscribe: [
    ['one-click', 'has a one-click unsubscribe'],
    [['header', 'none'], 'has no one-click unsubscribe'],
  ],
  listId: [
    [true, 'came through a mailing list'],
    [false, 'did not come through a mailing list'],
  ],
  markedBulk: [
    [true, 'is marked bulk'],
    [false, 'is not marked bulk'],
  ],
  bulkService: [
    [true, 'was sent through a bulk mail service'],
    [false, 'was sent through no bulk mail service Sift knows'],
  ],
  dmarc: [
    ['pass', 'passed DMARC'],
    [['fail', 'none'], 'did not pass DMARC'],
  ],
  replyToDiffers: [
    [true, 'has replies going elsewhere'],
    [false, 'has replies going to the sender'],
  ],
  addressed: [
    ['to', 'is addressed to you'],
    ['cc', 'copies you'],
    ['neither', 'does not name you'],
  ],
  isReply: [
    [true, 'is a reply'],
    [false, 'is not a reply'],
  ],
  category: [
    ['personal', 'is in Primary'],
    ['promotions', 'is in Promotions'],
    ['social', 'is in Social'],
    ['updates', 'is in Updates'],
    ['forums', 'is in Forums'],
  ],
  important: [
    [true, 'Gmail marked important'],
    [false, 'Gmail did not mark important'],
  ],
  hasAttachments: [
    [true, 'has attachments'],
    [false, 'has no attachments'],
  ],
  trackingPixel: [[true, 'has a tracking pixel']],
} as const satisfies { [K in keyof RuleFacts]-?: readonly (readonly [NonNullable<RuleFacts[K]>, string])[] };
export type FactKey = keyof typeof FACTS;

/** One condition on a fact: which fact, and which of its answers in `FACTS`. */
export interface FactAnswer {
  key: FactKey;
  index: number;
}
const answerOf = ({ key, index }: FactAnswer) => (FACTS[key] as readonly (readonly [unknown, string])[])[index];
export const factWords = (answer: FactAnswer) => answerOf(answer)?.[1] ?? '';
/** The same answer: a list holds the same values in any order. */
const same = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v) => b.includes(v)) : a === b);
/** A rule's conditions on facts, as answers. */
export const factAnswers = (facts: RuleFacts = {}): FactAnswer[] =>
  Object.entries(facts).flatMap(([key, want]) => {
    const index = (FACTS[key as FactKey] as readonly (readonly [unknown, string])[] | undefined)?.findIndex(([value]) => same(value, want)) ?? -1;
    return index === -1 ? [] : [{ key: key as FactKey, index }];
  });
/** Answers as the conditions a rule carries. */
export const factConditions = (answers: readonly FactAnswer[]): RuleFacts =>
  Object.fromEntries(answers.map((answer) => [answer.key, answerOf(answer)?.[0]])) as RuleFacts;
/** An answer as one string, for a select's value. */
export const factParam = ({ key, index }: FactAnswer) => `${key}:${index}`;

/** The facts Suggestions and Activity can be narrowed by (`FACT_FILTERS`, src/dashboard/types.ts), in the words of the conditions they are. */
export const FACT_FILTER_WORDS = [
  ['reply', 'is a reply'],
  ['list', 'came through a mailing list'],
  ['one-click', 'has a one-click unsubscribe'],
  ['bulk-service', 'was sent through a bulk mail service'],
  ['not-to-you', 'does not name you'],
  ['unproven', 'did not pass DMARC'],
  ['attachments', 'has attachments'],
] as const satisfies readonly (readonly [FactFilter, string])[];
/** For a filter panel, with "any" first. */
export const FACT_FILTER_OPTIONS = [['', 'Any'] as const, ...FACT_FILTER_WORDS.map(([key, words]) => [key, capitalised(words)] as const)];
/** A fact filter that is on, as its chip says it. */
export const factFilterName = (key: FactFilter) => `Mail that ${FACT_FILTER_WORDS.find(([k]) => k === key)?.[1] ?? key}`;

/** A match's named conditions in the order a sentence reads them, whatever order they were stored in; typed text is quoted. */
export function conditionsOf(match: RuleMatch): (readonly [string, string])[] {
  const order = ['from', 'fromDomain', 'fromName', 'fromNameContains', 'to', 'listId', 'subjectContains'] as const;
  const typed = new Set<string>(['fromName', 'fromNameContains', 'subjectContains']);
  return order.flatMap((key) => {
    const value = match[key];
    return value === undefined ? [] : [[key, typed.has(key) ? `“${value}”` : value] as const];
  });
}

const MATCH: Record<string, string> = {
  from: 'from',
  fromDomain: 'from anyone at',
  fromName: 'named',
  fromNameContains: 'with a name containing',
  to: 'sent to',
  listId: 'on the list',
  subjectContains: 'with a subject containing',
};
/** A rule's conditions as words to follow "mail": "from news@example.com, with a subject containing …, that is a reply". */
export function describeMatch(match: RuleMatch): string {
  const named = conditionsOf(match).map(([key, value]) => `${MATCH[key]} ${value}`);
  const asked = factAnswers(match.facts).map(factWords);
  return [...named, ...(asked.length > 0 ? [`that ${asked.join(' and ')}`] : [])].join(', ');
}

/** How the owner and a sender (or a domain) know each other, as pointing at its icon says it. */
export const CONTACT_SAYS = {
  new: 'The first time Sift has seen them',
  mutual: 'You have written to them',
  'one-way': 'They write often and you have never written back',
} as const;

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
