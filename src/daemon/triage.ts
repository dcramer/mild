import type { Sql } from '../store/sql.ts';
import { execute } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { UnsubscribeOutcome } from '../actions/unsubscribe.ts';
import { planAction } from '../actions/plan.ts';
import type { Account } from '../store/accounts.ts';
import { shotCandidates } from '../store/examples.ts';
import { listLabels } from '../store/labels.ts';
import { listUnsettledDecisions, recordDecision, settleDecision } from '../store/decisions.ts';
import { listUndecided } from '../store/messages.ts';
import { proposeForSender, proposeSettled } from '../store/proposals.ts';
import { blockSender, countRuleHit, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import { passedDmarc } from '../triage/features.ts';
import { triage } from '../triage/pipeline.ts';
import { heuristicsStage } from '../triage/stages/heuristics.ts';
import { priorRule, rulesStage, settle } from '../triage/stages/rules.ts';
import { type Judge, modelStage } from '../triage/stages/model.ts';
import type { Decision, Disposition, MessageFacts, Stage } from '../triage/types.ts';
import { type EvidenceSources, gatherEvidence, ownerHasWritten } from './evidence.ts';

export interface TriageDeps {
  db: Sql;
  /** Null means observe: decisions are recorded and nothing in the mailbox changes. */
  mailbox: Mailbox | null;
  /** While sift only observes: the mailbox to carry out the user's own answers in. Nothing else is done with it. */
  answers?: Mailbox | null;
  /** The inference tier. Omitted when no model is configured: mail no rule covers goes to review. */
  model?: ModelTier;
  /** The heuristics tier, when the user has turned it on. The mailbox is only searched, for whether the owner has written to a sender. */
  heuristics?: { mailbox: Pick<Mailbox, 'hasSentTo'> };
  /**
   * Leaves a mailing list. Called for a decision that says to unsubscribe, after its mailbox change has
   * gone through. Omitted in tests and tools that must not reach the network.
   */
  unsubscribe?: (accountId: string, messageId: string) => Promise<UnsubscribeOutcome>;
  now?: () => number;
}

export interface ModelTier {
  judge: Judge;
  /** Read access for evidence. Used in observe mode too; it never changes the mailbox. */
  sources: Omit<EvidenceSources, 'db' | 'now'>;
  /** The user's broad guidance, in plain language. */
  guidelines: string;
  /** False: mail the user labelled before is not shown to the model as examples. */
  fewShot?: boolean;
}

export interface TriageReport {
  /** New decisions this pass, by disposition. */
  decided: Record<Disposition, number>;
  /** Mailbox changes completed (including retries of earlier decisions). */
  acted: number;
  /** Decisions whose action was not attempted, e.g. the message had left the inbox or spam was refused. */
  skipped: number;
  /** Actions that failed or whose result is unconfirmed. */
  troubled: number;
  /** Rules sift proposed this pass, for the user to accept. */
  proposed: number;
  /** Senders blocked this pass. */
  blocked: number;
  /** Mailing lists left this pass. */
  unsubscribed: number;
}

/**
 * The cascade for one account, as a function that decides one message: the tiers cheapest first, then
 * the rules that wait for a label. The decision-model tier would slot in after the heuristics.
 */
export async function cascadeFor(deps: TriageDeps, accountId: string): Promise<(facts: MessageFacts) => Promise<Decision>> {
  const { db, model } = deps;
  const labels = await listLabels(db, accountId);
  const rules = await listRules(db, accountId);
  // The rules ask whether the owner has written to the sender as they rank; the answer is read before
  // each message, and again whenever something in the cascade may have just found out.
  let written: boolean | undefined;
  const options = { hasWritten: () => written };
  const read = async (facts: MessageFacts) => (written = await cachedCorrespondent(db, facts.accountId, facts.from.address));
  const stages: Stage[] = [rulesStage(rules, labels, { ...options, judged: model !== undefined })];
  if (deps.heuristics) {
    const sources = { db, mailbox: deps.heuristics.mailbox, ...(deps.now ? { now: deps.now } : {}) };
    stages.push(
      heuristicsStage({
        labels,
        hasWritten: async (facts) => {
          const known = await ownerHasWritten(sources, facts);
          written = known ?? undefined;
          return known;
        },
      }),
    );
  }
  if (model) {
    stages.push(
      modelStage({
        judge: model.judge,
        labels,
        guidelines: model.guidelines,
        gather: async (facts) => await gatherEvidence({ db, ...model.sources, ...(deps.now ? { now: deps.now } : {}) }, facts),
        prior: (facts) => {
          const hit = priorRule(rules, labels, facts, options);
          return hit?.label ? { rule: hit.rule, label: hit.label } : null;
        },
        ...(model.fewShot === false ? {} : { examples: async (facts) => await shotCandidates(db, facts) }),
      }),
    );
  }
  return async (facts) => {
    await read(facts);
    return await triage(stages, facts, async (decision) => (await read(facts), settle(rules, labels, facts, decision, options)));
  };
}

/**
 * Decide every recorded message that has no decision yet and, when a mailbox is given, carry the
 * decisions out. Each decision is recorded before anything is changed; if the change cannot be
 * attempted (a provider error), the decision stays unsettled and the next pass retries it.
 */
export async function triageAccount(deps: TriageDeps, account: Account, limit = 200): Promise<TriageReport> {
  const { db, mailbox } = deps;
  const now = deps.now ?? Date.now;
  const report: TriageReport = {
    decided: { keep: 0, archive: 0, spam: 0, review: 0 },
    acted: 0,
    skipped: 0,
    troubled: 0,
    proposed: 0,
    blocked: 0,
    unsubscribed: 0,
  };

  const carryOut = async (decisionId: number, messageId: string, decision: Pick<Decision, 'disposition' | 'gmailLabel' | 'markRead'>, box: Mailbox) => {
    const action = planAction(decision);
    if (!action) {
      await settleDecision(db, decisionId, 'none');
      return 'none';
    }
    const outcome = await execute({ db, mailbox: box, now }, account.id, messageId, action, decisionId);
    await settleDecision(db, decisionId, outcome.status, outcome.status === 'done' ? null : outcome.reason);
    if (outcome.status === 'done') report.acted++;
    else if (outcome.status === 'skipped') report.skipped++;
    else report.troubled++;
    return outcome.status;
  };

  if (mailbox) {
    for (const pending of await listUnsettledDecisions(db, account.id)) await carryOut(pending.id, pending.messageId, pending, mailbox);
  } else if (deps.answers) {
    for (const pending of await listUnsettledDecisions(db, account.id, { byUserOnly: true }))
      await carryOut(pending.id, pending.messageId, pending, deps.answers);
  }

  const decide = await cascadeFor(deps, account.id);
  for (const { facts, observeOnly } of await listUndecided(db, account.id, limit)) {
    const act = mailbox !== null && !observeOnly;
    const started = performance.now();
    const decision = await decide(facts);
    const decisionId = await recordDecision(db, account.id, facts.messageId, decision, {
      mode: act ? 'act' : 'observe',
      durationMs: Math.round(performance.now() - started),
      now: now(),
    });
    if (decision.ruleId) await countRuleHit(db, decision.ruleId);
    if (decision.stage === 'agent') {
      const proposed = decision.priorRuleId
        ? await proposeSettled(db, account.id, decision.priorRuleId, now())
        : await proposeForSender(db, account.id, facts.from.address, now());
      if (proposed) report.proposed++;
    }
    report.decided[decision.disposition]++;
    const status = act ? await carryOut(decisionId, facts.messageId, decision, mailbox) : null;
    // Blocking acts on the sender's address, so the address must be proven: a message that only claims to be
    // from someone would otherwise get that someone blocked. And only once the message itself was marked spam.
    if (
      status === 'done' &&
      decision.block &&
      decision.labelId &&
      passedDmarc(facts.headers) &&
      (await blockSender(db, account.id, facts.from.address, decision.labelId, now()))
    )
      report.blocked++;
    // Unsubscribing follows the mailbox change, never goes ahead of it, and never happens to someone the user writes to.
    if (
      (status === 'done' || status === 'none') &&
      decision.subscription === 'unsubscribe' &&
      deps.unsubscribe &&
      (await cachedCorrespondent(db, account.id, facts.from.address)) !== true &&
      (await deps.unsubscribe(account.id, facts.messageId)).status === 'done'
    )
      report.unsubscribed++;
  }
  return report;
}
