import { and, decisions, desc, eq, feedback, messages, proposals } from './query.ts';
import type { Sql } from './sql.ts';
import { conditionsHash, hashOf, openJson, proposalName, sealJson } from './content.ts';
import type { RuleMatch } from '../triage/stages/rules.ts';
import type { DecidedDisposition } from '../triage/types.ts';
import { listLabels } from './labels.ts';
import { hasRuleFor } from './rules.ts';
import type { Sealed } from '../confidential.ts';

/** A rule Sift thinks is worth having: "from them, when it is this label → what the user has been doing to it". */
export interface Proposal {
  id: number;
  accountId: string;
  match: RuleMatch;
  labelId: string;
  /** What the user has been doing to the label's mail instead of what the label does. */
  disposition: DecidedDisposition;
  /** How many decisions in a row it rests on. */
  agreed: number;
  createdAt: number;
}

const COLUMNS = {
  id: proposals.id,
  accountId: proposals.accountId,
  match: proposals.match,
  labelId: proposals.labelId,
  disposition: proposals.disposition,
  agreed: proposals.agreed,
  createdAt: proposals.createdAt,
};

export async function listProposals(db: Sql, accountId?: string): Promise<(Omit<Proposal, 'match'> & { match: Sealed<RuleMatch> })[]> {
  const rows = await db
    .select(COLUMNS)
    .from(proposals)
    .where(and(eq(proposals.status, 'open'), accountId === undefined ? undefined : eq(proposals.accountId, accountId)))
    .orderBy(desc(proposals.createdAt), desc(proposals.id));
  return rows.map((r) => opened(db, r));
}

const opened = <R extends { accountId: string; match: string }>(db: Sql, r: R): Omit<R, 'match'> & { match: Sealed<RuleMatch> } => ({
  ...r,
  match: openJson<RuleMatch>(db, proposalName(db, r.accountId), r.match),
});

/** Open a proposal, or refresh the count on one already open. One the user dismissed stays dismissed. Returns true if it is new. */
async function propose(db: Sql, p: Omit<Proposal, 'id' | 'createdAt'>, now: number): Promise<boolean> {
  const [existing] = await db
    .select({ id: proposals.id, status: proposals.status })
    .from(proposals)
    .where(and(eq(proposals.accountId, p.accountId), eq(proposals.conditions, conditionsHash(db, p.match))));
  if (existing) {
    if (existing.status === 'open')
      await db.update(proposals).set({ agreed: p.agreed, labelId: p.labelId, disposition: p.disposition }).where(eq(proposals.id, existing.id));
    return false;
  }
  await db.insert(proposals).values({
    accountId: p.accountId,
    match: sealJson(db, proposalName(db, p.accountId), p.match),
    conditions: conditionsHash(db, p.match),
    labelId: p.labelId,
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
  const label = (await listLabels(db)).find((l) => l.id === labelId);
  if (!label) return false;
  const match = { from: [address] };
  if ((await hasRuleFor(db, match)) || (await hasRuleFor(db, match, labelId))) return false;
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
  return await propose(db, { accountId, match, labelId, disposition: first.disposition, agreed }, now);
}

/**
 * Dismiss a proposal. A proposal is never accepted here but made into a rule in the rule dialog
 * (`madeFromProposal`), so the user sees and can change the rule first. Returns false if it was not open.
 */
export async function dismissProposal(db: Sql, id: number, now: number = Date.now()): Promise<boolean> {
  const done = await db
    .update(proposals)
    .set({ status: 'dismissed', resolvedAt: now })
    .where(and(eq(proposals.id, id), eq(proposals.status, 'open')))
    .returning({ id: proposals.id });
  return done.length > 0;
}

/** Mark a proposed rule for `accountId` accepted, once a rule has been made from it. Returns false if there is no such proposal open. */
export async function madeFromProposal(db: Sql, id: number, now: number = Date.now()): Promise<boolean> {
  const done = await db
    .update(proposals)
    .set({ status: 'accepted', resolvedAt: now })
    .where(and(eq(proposals.id, id), eq(proposals.status, 'open')))
    .returning({ id: proposals.id });
  return done.length > 0;
}
