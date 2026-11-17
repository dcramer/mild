import type { GmailApi } from '../gmail/api.ts';
import { toFacts } from '../gmail/sync.ts';
import { recordSynced } from '../store/accounts.ts';
import { currentDecision, recordDecision } from '../store/decisions.ts';
import { listLabels } from '../store/labels.ts';
import { getFacts, markApplying } from '../store/messages.ts';
import { countRuleHit, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import type { Sql } from '../store/sql.ts';
import { type RuleMatch, priorRule, rulesStage } from '../triage/stages/rules.ts';
import type { Decision, MessageFacts } from '../triage/types.ts';
import { MAX_BACKFILL } from './backfill.ts';
import { Refusal } from '../refusal.ts';

/** What one press looks at in the inbox: the same bound as pulling in older mail, on Gmail calls and on what it can send to a model. */
const MOST = MAX_BACKFILL;

/** What the rule would do to one message: decide it now, or wait for a model to say what it is. */
type Plan = { decide: Decision; again: boolean } | { read: true };

export interface InboxMatch {
  messageId: string;
  subject: string;
  receivedAt: number;
  /** Sift has a record of it. */
  seen: boolean;
  /** A model must say what it is before the rule can apply. */
  reads: boolean;
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

async function ruleOf(db: Sql, accountId: string, ruleId: string) {
  const rules = await listRules(db, accountId);
  if (!rules.some((r) => r.id === ruleId)) throw new Refusal('That rule no longer exists.');
  return { rules, labels: await listLabels(db, accountId) };
}

/**
 * What `ruleId` does to one message, as the rules stand: null when it does nothing (another rule decides
 * it, the user has had their say, or Sift already carried out a decision). A rule that needs a model applies
 * at once to mail a tier already placed, and otherwise waits for the model.
 */
async function planFor(db: Sql, given: Awaited<ReturnType<typeof ruleOf>>, ruleId: string, facts: MessageFacts, now: number): Promise<Plan | null> {
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

async function searchInbox(api: Pick<GmailApi, 'searchInbox'>, query: string): Promise<{ ids: string[]; capped: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api.searchInbox(query, pageToken);
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MOST);
  return { ids: ids.slice(0, MOST), capped: ids.length > MOST || pageToken !== undefined };
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
 * The mail in the inbox now that a rule would decide, found by searching Gmail and checking the rule on
 * each message. Nothing is recorded or changed. `capped`: the inbox had more than one press looks at.
 */
export async function ruleInbox(
  db: Sql,
  api: Pick<GmailApi, 'searchInbox' | 'getMetadata'>,
  accountId: string,
  ruleId: string,
  now: number = Date.now(),
): Promise<{ matches: InboxMatch[]; capped: boolean }> {
  const given = await ruleOf(db, accountId, ruleId);
  const rule = given.rules.find((r) => r.id === ruleId)!;
  const { ids, capped } = await searchInbox(api, inboxQuery(rule.match));
  const matches: InboxMatch[] = [];
  for (const id of ids) {
    const found = await factsOf(db, api, accountId, id);
    const plan = found && (await planFor(db, given, ruleId, found.facts, now));
    if (!found || !plan) continue;
    matches.push({ messageId: id, subject: found.facts.subject, receivedAt: found.facts.receivedAt, seen: found.seen, reads: 'read' in plan });
  }
  return { matches, capped };
}

/**
 * Apply a rule to messages the user saw in its preview: each is checked again, and what the rule decides is
 * recorded as the user's press, to be carried out on the next pass whether Sift is on or off. Mail that needs a
 * model first is recorded and marked, so the pass carries out what the rule decides once the model has spoken.
 */
export async function applyRule(
  db: Sql,
  api: Pick<GmailApi, 'getMetadata'>,
  accountId: string,
  ruleId: string,
  messageIds: readonly string[],
  now: number = Date.now(),
): Promise<{ deciding: number; reading: number }> {
  const given = await ruleOf(db, accountId, ruleId);
  let deciding = 0;
  let reading = 0;
  for (const id of new Set(messageIds.slice(0, MOST))) {
    const found = await factsOf(db, api, accountId, id);
    if (!found) continue;
    const plan = await db.transaction(async (tx) => {
      const plan = await planFor(tx, given, ruleId, found.facts, now);
      if (!plan) return null;
      if (!found.seen) await recordSynced(tx, accountId, [found.facts], now);
      if ('read' in plan) await markApplying(tx, accountId, id, ruleId);
      else {
        await recordDecision(tx, accountId, id, plan.decide, { carryOut: true, byUser: true, now });
        if (!plan.again) await countRuleHit(tx, ruleId);
      }
      return plan;
    });
    if (plan && 'read' in plan) reading++;
    else if (plan) deciding++;
  }
  return { deciding, reading };
}
