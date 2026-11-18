import type { GmailApi } from '../gmail/api.ts';
import { toFacts } from '../gmail/sync.ts';
import { recordSynced } from '../store/accounts.ts';
import { currentDecision, recordDecision } from '../store/decisions.ts';
import { listLabels } from '../store/labels.ts';
import { REACH } from '../store/inbox.ts';
import { getFacts, markApplying } from '../store/messages.ts';
import { countRuleHit, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import type { Sql } from '../store/sql.ts';
import { type RuleMatch, priorRule, rulesStage } from '../triage/stages/rules.ts';
import type { Decision, MessageFacts } from '../triage/types.ts';
import { Refusal } from '../refusal.ts';

/** How many of the newest the preview checks the rule on, to say about how many it would decide. */
const SAMPLE = 20;
/** The newest of those the preview shows. */
export const EXAMPLES = 5;

/** What the rule would do to one message: decide it now, or wait for a model to say what it is. */
type Plan = { decide: Decision; again: boolean } | { read: true };

interface InboxMatch {
  messageId: string;
  subject: string;
  receivedAt: number;
}

/** What applying a rule to the inbox would do, from its newest matches. */
export interface InboxSample {
  examples: InboxMatch[];
  /** How many it would decide, or about how many when only some were checked; at most what one press goes through. */
  messages: number;
  /** Of `messages`, how many a model must read first. */
  reading: number;
  exact: boolean;
  /** How many one press goes through, when more match than that. */
  most: number | null;
}

// The values go into a Gmail search, so anything that could change its meaning is left out, which only widens it.
const PLAIN = /^[\w.@+-]+$/;
const QUOTABLE = /^[^"\\()]+$/;

/** A Gmail search for the inbox mail a rule could match. It only narrows: the rule itself is checked on each message found. */
export function inboxQuery(match: RuleMatch): string {
  const terms: string[] = [];
  // Several values are alternatives; one that cannot be searched for leaves the whole condition out.
  const add = (operator: string, values: readonly string[], quote: boolean) => {
    if (values.length === 0 || !values.every((v) => (quote ? QUOTABLE : PLAIN).test(v))) return;
    const each = values.map((v) => (quote ? `"${v}"` : v));
    terms.push(`${operator}:${each.length === 1 ? each[0] : `(${each.join(' OR ')})`}`);
  };
  add('from', [...(match.from ?? []), ...(match.fromDomain ?? [])], false);
  add('to', match.to ?? [], false);
  add('list', match.listId ?? [], false);
  add('subject', match.subjectContains ?? [], true);
  return terms.join(' ');
}

/** The person's rules and labels, with `ruleId` among them, to apply in one of their mailboxes; null once it has been removed. */
export async function rulesWith(db: Sql, accountId: string, ruleId: string) {
  const rules = await listRules(db);
  const rule = rules.find((r) => r.id === ruleId);
  return rule ? { accountId, rule, rules, labels: await listLabels(db) } : null;
}
type Given = NonNullable<Awaited<ReturnType<typeof rulesWith>>>;

/**
 * What `ruleId` does to one message, as the rules stand: null when it does nothing (another rule decides
 * it, the user has had their say, or Sift already carried out a decision). A rule that needs a model applies
 * at once to mail a tier already placed, and otherwise waits for the model.
 */
async function planFor(db: Sql, given: Given, ruleId: string, facts: MessageFacts, now: number): Promise<Plan | null> {
  const current = await currentDecision(db, facts.accountId, facts.messageId);
  if (current && (current.answered || current.carryOut)) return null;
  const written = await cachedCorrespondent(db, facts.accountId, facts.from.address, now);
  const options = { hasWritten: () => written };
  // A rule that waits for a label was applied to its tier's decision when the rule was made.
  if (current?.decision.ruleId === ruleId) return { decide: current.decision, again: true };
  const decided = await rulesStage(given.rules, given.labels, { ...options, judged: true }).decide(facts);
  if (decided?.ruleId === ruleId) return { decide: decided, again: false };
  if (current) return null;
  return priorRule(given.rules, given.labels, facts, options)?.rule.id === ruleId ? { read: true } : null;
}

/** Recorded facts, or Gmail's for mail Sift never saw (null when it has gone). */
async function factsOf(db: Sql, api: Pick<GmailApi, 'getMetadata'>, accountId: string, messageId: string) {
  const stored = await getFacts(db, accountId, messageId);
  if (stored) return { facts: stored, seen: true };
  const raw = await api.getMetadata(messageId);
  const facts = raw ? toFacts(accountId, raw) : null;
  return facts && facts.labelIds.includes('INBOX') ? { facts, seen: false } : null;
}

/**
 * What applying a rule to the inbox would do, found by searching Gmail and checking the rule on the newest
 * `SAMPLE`: exact when that is all there is, and otherwise scaled to Gmail's estimate of how many match the
 * search, which is rough. Nothing is recorded or changed.
 */
export async function ruleInbox(
  db: Sql,
  api: Pick<GmailApi, 'searchInbox' | 'getMetadata'>,
  accountId: string,
  ruleId: string,
  now: number = Date.now(),
): Promise<InboxSample> {
  const given = await rulesWith(db, accountId, ruleId);
  if (!given) throw new Refusal('That rule no longer exists.');
  const page = await api.searchInbox(inboxQuery(given.rule.match));
  const found = page.nextPageToken ? Math.max(page.estimate ?? 0, page.ids.length) : page.ids.length;
  const sample = page.ids.slice(0, SAMPLE);
  const checked = await Promise.all(
    sample.map(async (id) => {
      const message = await factsOf(db, api, accountId, id);
      const plan = message && (await planFor(db, given, ruleId, message.facts, now));
      return message && plan ? { facts: message.facts, reads: 'read' in plan } : null;
    }),
  );
  const matched = checked.filter((m) => m !== null);
  const exact = sample.length === found;
  const scale = exact || sample.length === 0 ? 1 : Math.min(found, REACH.inbox) / sample.length;
  return {
    examples: matched.slice(0, EXAMPLES).map(({ facts }) => ({ messageId: facts.messageId, subject: facts.subject, receivedAt: facts.receivedAt })),
    messages: Math.round(matched.length * scale),
    reading: Math.round(matched.filter((m) => m.reads).length * scale),
    exact,
    most: found > REACH.inbox ? REACH.inbox : null,
  };
}

/**
 * Apply a rule to one message in the inbox, as the user's press: what it decides is recorded to be carried out
 * on the next pass whether Sift is on or off. Mail that needs a model first is recorded and marked, so the pass
 * carries out what the rule decides once the model has spoken. Null when the rule does nothing to it.
 */
export async function applyTo(
  db: Sql,
  api: Pick<GmailApi, 'getMetadata'>,
  given: Given,
  messageId: string,
  now: number,
): Promise<'deciding' | 'reading' | null> {
  const { accountId, rule } = given;
  const ruleId = rule.id;
  const found = await factsOf(db, api, accountId, messageId);
  if (!found) return null;
  return await db.transaction(async (tx) => {
    const plan = await planFor(tx, given, ruleId, found.facts, now);
    if (!plan) return null;
    if (!found.seen) await recordSynced(tx, accountId, [found.facts], now);
    if ('read' in plan) {
      await markApplying(tx, accountId, messageId, ruleId);
      return 'reading';
    }
    await recordDecision(tx, accountId, messageId, plan.decide, { carryOut: true, byUser: true, now });
    if (!plan.again) await countRuleHit(tx, ruleId);
    return 'deciding';
  });
}
