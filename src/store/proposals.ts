import { type PROPOSAL_KINDS, alias, and, decisions, desc, eq, feedback, isNotNull, max, messages, proposals } from './query.ts';
import type { Sql } from './sql.ts';
import { conditionsHash, hashOf, openJson, proposalName, sealJson } from './content.ts';
import type { Rule, RuleMatch } from '../triage/stages/rules.ts';
import type { DecidedDisposition, Label } from '../triage/types.ts';
import { listLabels } from './labels.ts';
import { hasRuleFor, listRules, removeRule, setRule } from './rules.ts';

type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export interface Proposal {
  id: number;
  accountId: string;
  kind: ProposalKind;
  match: RuleMatch;
  labelId: string;
  ruleId: string | null;
  /** How many decisions in a row it rests on. */
  agreed: number;
  createdAt: number;
}

const COLUMNS = {
  id: proposals.id,
  accountId: proposals.accountId,
  kind: proposals.kind,
  match: proposals.match,
  labelId: proposals.labelId,
  ruleId: proposals.ruleId,
  agreed: proposals.agreed,
  createdAt: proposals.createdAt,
};

export async function listProposals(db: Sql, accountId?: string): Promise<Proposal[]> {
  const rows = await db
    .select(COLUMNS)
    .from(proposals)
    .where(and(eq(proposals.status, 'open'), accountId === undefined ? undefined : eq(proposals.accountId, accountId)))
    .orderBy(desc(proposals.createdAt), desc(proposals.id));
  return rows.map((r) => opened(db, r));
}

const opened = <R extends { accountId: string; match: string }>(db: Sql, r: R): Omit<R, 'match'> & { match: RuleMatch } => ({
  ...r,
  match: openJson<RuleMatch>(db, proposalName(db, r.accountId), r.match),
});

/** Open a proposal, or refresh the count on one already open. One the user dismissed stays dismissed. Returns true if it is new. */
async function propose(db: Sql, p: Omit<Proposal, 'id' | 'createdAt'>, now: number): Promise<boolean> {
  const [existing] = await db
    .select({ id: proposals.id, status: proposals.status })
    .from(proposals)
    .where(and(eq(proposals.accountId, p.accountId), eq(proposals.kind, p.kind), eq(proposals.conditions, conditionsHash(db, p.match))));
  if (existing) {
    if (existing.status === 'open')
      await db.update(proposals).set({ agreed: p.agreed, labelId: p.labelId, ruleId: p.ruleId }).where(eq(proposals.id, existing.id));
    return false;
  }
  await db.insert(proposals).values({
    accountId: p.accountId,
    kind: p.kind,
    match: sealJson(db, proposalName(db, p.accountId), p.match),
    conditions: conditionsHash(db, p.match),
    labelId: p.labelId,
    ruleId: p.ruleId,
    agreed: p.agreed,
    createdAt: now,
  });
  return true;
}

const later = alias(decisions, 'later');

/** How many messages in a row the model must have labelled alike before sift proposes a rule for the sender. */
export const PROPOSE_AFTER = 5;
/** How many times in a row the model must agree with a `usually` rule before sift proposes to stop checking it. */
const SETTLED_AFTER = 10;

/**
 * Propose a rule for a sender once the model has given their last few messages the same label and each
 * ended the way the label says. Each message counts once, by where it stands now: one the user answered,
 * or that a rule decided since, is not the model's. Senders who send mixed mail never settle. Nothing is
 * proposed where a rule for exactly that sender exists. Returns true if a proposal was opened.
 */
export async function proposeForSender(db: Sql, accountId: string, address: string, now: number = Date.now()): Promise<boolean> {
  if (await hasRuleFor(db, accountId, { from: address })) return false;
  const recent = await db
    .select({ labelId: decisions.labelId, disposition: decisions.disposition, priorRuleId: decisions.priorRuleId })
    .from(decisions)
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .where(
      and(
        eq(decisions.accountId, accountId),
        eq(messages.senderHash, hashOf(db, address)),
        eq(
          decisions.id,
          db
            .select({ id: max(later.id) })
            .from(later)
            .where(and(eq(later.accountId, decisions.accountId), eq(later.messageId, decisions.messageId))),
        ),
        eq(decisions.stage, 'model'),
        isNotNull(decisions.runId),
      ),
    )
    .orderBy(desc(decisions.id))
    .limit(PROPOSE_AFTER);
  const [first] = recent;
  if (!first || recent.length < PROPOSE_AFTER || first.labelId === null) return false;
  const label = (await listLabels(db, accountId)).find((l) => l.id === first.labelId)!;
  // One where a protection held sift back, or a wider rule already spoke, is not settled.
  if (!recent.every((r) => r.labelId === first.labelId && r.disposition === label.disposition && r.priorRuleId === null)) return false;
  return await propose(db, { accountId, kind: 'rule', match: { from: address }, labelId: first.labelId, ruleId: null, agreed: recent.length }, now);
}

/** How many answers in a row about a sender, all the same label, before sift offers to make it a rule. */
const PROPOSE_AFTER_ANSWERS = 3;

/**
 * Propose a rule for a sender whose last few answers all said the same label, and each let the label do what
 * it does. Answering one message makes no rule; this is how answers turn into one, with the user's say-so.
 * An answer that kept the label but not its action ("Marketing, but keep it") breaks the run: the rule
 * proposed would do what the user just said not to.
 */
export async function proposeFromAnswers(db: Sql, accountId: string, address: string, now: number = Date.now()): Promise<boolean> {
  if (await hasRuleFor(db, accountId, { from: address })) return false;
  const recent = await db
    .select({ labelId: feedback.labelId, disposition: feedback.disposition })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .where(and(eq(feedback.accountId, accountId), eq(messages.senderHash, hashOf(db, address))))
    .orderBy(desc(feedback.createdAt), desc(feedback.decisionId))
    .limit(PROPOSE_AFTER_ANSWERS);
  const [first] = recent;
  if (!first || recent.length < PROPOSE_AFTER_ANSWERS || first.labelId === null) return false;
  const label = (await listLabels(db, accountId)).find((l) => l.id === first.labelId);
  if (!label) return false;
  const does = label.disposition === 'review' ? 'keep' : label.disposition;
  if (!recent.every((r) => r.labelId === first.labelId && r.disposition === does)) return false;
  return await propose(db, { accountId, kind: 'rule', match: { from: address }, labelId: first.labelId, ruleId: null, agreed: recent.length }, now);
}

/** Propose dropping the "when it is L" from a rule once every message it was checked against turned out to be L, for long enough. */
export async function proposeSettled(db: Sql, accountId: string, ruleId: string, now: number = Date.now()): Promise<boolean> {
  const rule = (await listRules(db, accountId)).find((r) => r.id === ruleId);
  if (!rule || rule.whenLabel === undefined) return false;
  const recent = await db
    .select({ ruleId: decisions.ruleId })
    .from(decisions)
    .where(eq(decisions.priorRuleId, ruleId))
    .orderBy(desc(decisions.id))
    .limit(SETTLED_AFTER);
  if (recent.length < SETTLED_AFTER || !recent.every((r) => r.ruleId === ruleId)) return false;
  return await propose(db, { accountId, kind: 'always', match: rule.match, labelId: rule.whenLabel, ruleId, agreed: recent.length }, now);
}

/** What a judged rule does to everything it matches once it stops waiting for its label: its own action, or the label's. */
export function settledAction(rule: Pick<Rule, 'disposition'>, label: Pick<Label, 'disposition'>): DecidedDisposition {
  const does = rule.disposition ?? label.disposition;
  return does === 'review' ? 'keep' : does;
}

/**
 * Dismiss a proposal, or accept one of kind `always`: the rule that waited for a label then acts on
 * everything it matches. A proposed rule is not accepted here but made from it (`madeFromProposal`), so
 * the user sees and can change the rule first. Returns false if it was not open.
 */
export async function resolveProposal(db: Sql, id: number, accept: boolean, now: number = Date.now()): Promise<boolean> {
  const [row] = await db
    .select(COLUMNS)
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.status, 'open')));
  if (!row) return false;
  const p = opened(db, row);
  if (accept) {
    if (p.kind === 'rule') throw new Error('A proposed rule is made from the rule dialog.');
    const existing = (await listRules(db, p.accountId)).find((r) => r.id === p.ruleId)!;
    const label = (await listLabels(db, p.accountId)).find((l) => l.id === p.labelId)!;
    // Takes this proposal with it.
    await removeRule(db, existing.id);
    await setRule(
      db,
      p.accountId,
      p.match,
      {
        disposition: settledAction(existing, label),
        ...(existing.subscription ? { subscription: existing.subscription } : {}),
        ...(existing.markRead ? { markRead: true } : {}),
      },
      'user',
      now,
    );
    return true;
  }
  await db.update(proposals).set({ status: 'dismissed', resolvedAt: now }).where(eq(proposals.id, id));
  return true;
}

/** Mark a proposed rule for `accountId` accepted, once a rule has been made from it. Returns false if there is no such proposal open. */
export async function madeFromProposal(db: Sql, id: number, accountId: string, now: number = Date.now()): Promise<boolean> {
  const done = await db
    .update(proposals)
    .set({ status: 'accepted', resolvedAt: now })
    .where(and(eq(proposals.id, id), eq(proposals.accountId, accountId), eq(proposals.kind, 'rule'), eq(proposals.status, 'open')))
    .returning({ id: proposals.id });
  return done.length > 0;
}
