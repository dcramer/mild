import type { RuleMatch, RuleSummary } from './api/endpoints.ts';
import { type FactAnswer, INBOX, factAnswers, factWords } from './words.ts';

/** A kind of condition the rule dialog holds a value for. `from` takes an address or a domain. */
export type By = 'from' | 'fromName' | 'fromNameContains' | 'listId' | 'to' | 'subjectContains';
/** One value of one kind. Several of a kind are alternatives; different kinds must all hold. */
export interface Condition {
  by: By;
  value: string;
}

/**
 * What the rule dialog starts on, from wherever it was opened: everything that place knows about the
 * mail. The user sees all of it, and changes it, before the rule is added.
 */
export interface RuleStart {
  conditions: Condition[];
  facts: FactAnswer[];
  label?: string;
  /** The label the rule waits for a tier to give, in place of `label`. */
  whenLabel?: string;
  /** With no label, or when it waits for one: what happens to the mail. */
  action?: 'keep' | 'archive' | 'spam';
}

const BY_KEYS = ['from', 'fromDomain', 'fromName', 'fromNameContains', 'listId', 'to', 'subjectContains'] as const;

/** A match's named conditions as the dialog holds them: an address and a domain are both `from`. */
export const conditionsOf = (match: RuleMatch): Condition[] =>
  BY_KEYS.flatMap((key) => (match[key] ?? []).map((value) => ({ by: key === 'fromDomain' ? 'from' : key, value })));

/** Conditions as a match: a `from` with a name before an @ is one address, otherwise everyone at the domain. Empty values are left out. */
export function matchOf(conditions: readonly Condition[]): RuleMatch {
  const match: RuleMatch = {};
  for (const { by, value } of conditions) {
    const given = value.trim();
    if (given === '') continue;
    const key = by !== 'from' ? by : /^[^@\s]+@[^@\s]+$/.test(given) ? 'from' : 'fromDomain';
    match[key] = [...(match[key] ?? []), key === 'fromDomain' ? given.replace(/^@/, '') : given];
  }
  return match;
}

/** What a rule waiting for a label does, for what the label does: a rule cannot block, and a label left for review is kept, as an answer keeps it. */
const WAITING_DOES = { keep: 'keep', archive: 'archive', spam: 'spam', block: 'spam', review: 'keep' } as const;

/**
 * A proposed rule, waiting for its label and then doing what `does` says: for a proposed rule, what the
 * user has been doing to that label's mail.
 */
export function proposalStart(match: RuleMatch, label: string, does: string): RuleStart {
  return {
    conditions: conditionsOf(match),
    facts: factAnswers(match.facts),
    whenLabel: label,
    action: WAITING_DOES[does as keyof typeof WAITING_DOES] ?? 'keep',
  };
}

/** A message's sender, as what Mild says the message is. */
export const messageStart = (sender: string, label: string | null): RuleStart => ({
  conditions: [{ by: 'from', value: sender }],
  facts: [],
  ...(label === null ? {} : { label }),
});

/** One name a sender uses, as what their mail under it mostly is. */
export const nameStart = (sender: string, name: string, label: string | null): RuleStart => {
  const start = messageStart(sender, label);
  return { ...start, conditions: [...start.conditions, { by: 'fromName', value: name }] };
};

/** A message's sender, when their mail is what Mild says it is but should stay in the inbox. */
export const keepStart = (sender: string, label: string): RuleStart => ({
  conditions: [{ by: 'from', value: sender }],
  facts: [],
  whenLabel: label,
  action: 'keep',
});

/** A message's sender and one thing Mild saw in it. */
export const factStart = (sender: string, fact: FactAnswer): RuleStart => ({ conditions: [{ by: 'from', value: sender }], facts: [fact] });

/** Everything on a mailing list. */
export const listStart = (listId: string): RuleStart => ({ conditions: [{ by: 'listId', value: listId }], facts: [] });

const STANDING_DOES = { trusted: 'keep', unwanted: 'archive', blocked: 'spam' } as const;

/** A standing is a rule for exactly that sender or domain that says only what happens to their mail. */
export const standingStart = (who: { address: string } | { domain: string }, standing: keyof typeof STANDING_DOES): RuleStart => ({
  conditions: [{ by: 'from', value: 'address' in who ? who.address : who.domain }],
  facts: [],
  action: STANDING_DOES[standing],
});

/** A value with its keys in one order, and a condition's values in one order and case, so two matches written differently compare alike. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? [...new Set(value.map((v) => v.toLowerCase()))].toSorted()
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;

/** The rule adding `match` would replace: one with exactly those conditions, no exceptions, waiting for the same label or none. */
export function replacedBy(rules: readonly RuleSummary[], match: RuleMatch, whenLabel: string | null): RuleSummary | undefined {
  const key = JSON.stringify(canonical(match));
  return rules.find((r) => r.whenLabel === whenLabel && r.except.length === 0 && JSON.stringify(canonical(r.match)) === key);
}

const WHICH: Record<By, string> = {
  from: 'from',
  fromName: 'named',
  fromNameContains: 'with a name containing',
  listId: 'on the list',
  to: 'sent to',
  subjectContains: 'with a subject containing',
};
const QUOTED = new Set<By>(['fromName', 'fromNameContains', 'subjectContains']);

/** Conditions in words, each kind once with its values as alternatives: "from a@example.com or example.org". */
function which(conditions: readonly Condition[]): string[] {
  const given = conditions.filter((c) => c.value.trim() !== '');
  return [...new Set(given.map((c) => c.by))].map((by) => {
    const values = given.filter((c) => c.by === by).map((c) => (QUOTED.has(by) ? `“${c.value.trim()}”` : c.value.trim()));
    return `${WHICH[by]} ${values.join(' or ')}`;
  });
}
const DO = { keep: 'leave it in the inbox', archive: 'archive it', spam: 'send it to spam' } as const;

/** What the rule dialog starts on, said as someone would describe the rule, for the box it opens on. */
export const startWords = (start: RuleStart, labels: readonly { id: string; name: string }[]): string => said(start, labels);

/**
 * A rule just added, for the toast that says so: the reader should not have to open Rules to learn what it was.
 * Its name, if it has one, stands for the mail it covers, as everywhere else; a condition in words is said with its label.
 */
export const addedWords = (rule: RuleStart, labels: readonly { id: string; name: string }[], given: { name?: string; when?: string } = {}): string =>
  said(rule, labels, given).replace(/[.: ]+$/, '');

function said(start: RuleStart, labels: readonly { id: string; name: string }[], { name, when }: { name?: string; when?: string } = {}): string {
  const named = (id: string | undefined) => labels.find((l) => l.id === id)?.name;
  const mail =
    name?.trim() || ['Mail', ...which(start.conditions), ...(start.facts.length > 0 ? [`that ${start.facts.map(factWords).join(' and ')}`] : [])].join(' ');
  const label = when?.trim() && named(start.label) ? `${named(start.label)}, if it is “${when.trim()}”` : named(start.label);
  const waits = named(start.whenLabel);
  if (waits) return `${mail}, once it is ${waits}: ${DO[start.action ?? 'keep']}.`;
  if (start.label === INBOX) return `${mail}: ${DO.keep}.`;
  if (label) return `${mail} is ${label}.`;
  return start.action ? `${mail}: ${DO[start.action]}.` : `${mail}: `;
}
