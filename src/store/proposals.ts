import { type PROPOSAL_KINDS, and, decisions, desc, eq, feedback, messages, proposals } from './query.ts';
import type { Sql } from './sql.ts';
import { conditionsHash, hashOf, openJson, proposalName, sealJson } from './content.ts';
import type { Rule, RuleMatch } from '../triage/stages/rules.ts';
import type { DecidedDisposition, Label } from '../triage/types.ts';
import { listLabels } from './labels.ts';
import { hasRuleFor, listRules, removeRule, setRule } from './rules.ts';
import { Refusal } from '../refusal.ts';

type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export interface Proposal {
  id: number;
  accountId: string;
  kind: ProposalKind;
  match: RuleMatch;
  labelId: string;
  ruleId: string | null;
  /** With `rule`: what the user has been doing to the label's mail instead of what the label does. */
  disposition: DecidedDisposition | null;
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
  disposition: proposals.disposition,
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
      await db
        .update(proposals)
        .set({ agreed: p.agreed, labelId: p.labelId, ruleId: p.ruleId, disposition: p.disposition })
        .where(eq(proposals.id, existing.id));
    return false;
  }
  await db.insert(proposals).values({
    accountId: p.accountId,
    kind: p.kind,
    match: sealJson(db, proposalName(db, p.accountId), p.match),
    conditions: conditionsHash(db, p.match),
    labelId: p.labelId,
    ruleId: p.ruleId,
    disposition: p.disposition,
    agreed: p.agreed,
    createdAt: now,
  });
  return true;
}

/**
 * How many of a sender's messages of one label the user must have given the same other action before Sift
 * offers a rule. Not one: one answer about one message does not become a rule about its sender.
 */
const PROPOSE_AFTER = 2;
/** How far back a run of answers is counted, for saying how many it rests on. */
const MAX_RUN = 20;

/**
 * Propose a rule for a sender whose mail of one label the user keeps giving another action than the label's:
 * moving their Notifications back to the inbox, or archiving their Account alerts. The model only says what
 * mail is, so no number of examples teaches it that; only a rule can. Answers that go with the label propose
 * nothing, since such a rule would do what already happens, and one breaks the run. Nothing is proposed where
 * the sender already has a rule for all their mail or for that label. Returns true if a proposal was opened.
 */
export async function proposeFromCorrections(db: Sql, accountId: string, address: string, labelId: string, now: number = Date.now()): Promise<boolean> {
  const label = (await listLabels(db, accountId)).find((l) => l.id === labelId);
  if (!label) return false;
  const match = { from: address };
  if ((await hasRuleFor(db, accountId, match)) || (await hasRuleFor(db, accountId, match, labelId))) return false;
  const recent = await db
    .select({ disposition: feedback.disposition })
    .from(feedback)
    .innerJoin(decisions, eq(decisions.id, feedback.decisionId))
    .innerJoin(messages, and(eq(messages.accountId, decisions.accountId), eq(messages.id, decisions.messageId)))
    .where(and(eq(feedback.accountId, accountId), eq(feedback.labelId, labelId), eq(messages.senderHash, hashOf(db, address))))
    .orderBy(desc(feedback.createdAt), desc(feedback.decisionId))
    .limit(MAX_RUN);
  const [first] = recent;
  const does = label.disposition === 'review' ? 'keep' : label.disposition;
  if (!first || first.disposition === does) return false;
  const run = recent.findIndex((r) => r.disposition !== first.disposition);
  const agreed = run === -1 ? recent.length : run;
  if (agreed < PROPOSE_AFTER) return false;
  return await propose(db, { accountId, kind: 'rule', match, labelId, ruleId: null, disposition: first.disposition, agreed }, now);
}

/** How many times in a row the model must agree with a `usually` rule before sift proposes to stop checking it. */
const SETTLED_AFTER = 10;

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
  return await propose(db, { accountId, kind: 'always', match: rule.match, labelId: rule.whenLabel, ruleId, disposition: null, agreed: recent.length }, now);
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
    if (p.kind === 'rule') throw new Refusal('A proposed rule is made from the rule dialog.');
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
