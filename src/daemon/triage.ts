import type { DatabaseSync } from 'node:sqlite';
import { execute } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import { planAction } from '../actions/plan.ts';
import type { Account } from '../store/accounts.ts';
import { listLabels } from '../store/labels.ts';
import { listUnsettledDecisions, recordDecision, settleDecision } from '../store/decisions.ts';
import { listUndecided } from '../store/messages.ts';
import { countRuleHit, learnSender, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import { triage } from '../triage/pipeline.ts';
import { rulesStage } from '../triage/stages/rules.ts';
import { type Judge, modelStage } from '../triage/stages/model.ts';
import type { Decision, Disposition, Stage } from '../triage/types.ts';
import { type EvidenceSources, gatherEvidence } from './evidence.ts';

export interface TriageDeps {
  db: DatabaseSync;
  /** Null means observe: decisions are recorded and nothing in the mailbox changes. */
  mailbox: Mailbox | null;
  /** The inference tier. Omitted when no model is configured: mail no rule covers goes to review. */
  model?: ModelTier;
  now?: () => number;
}

export interface ModelTier {
  judge: Judge;
  /** Read access for evidence. Used in observe mode too; it never changes the mailbox. */
  sources: Omit<EvidenceSources, 'db' | 'now'>;
  /** The user's broad guidance, in plain language. */
  guidelines: string;
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
  /** Rules sift made this pass, so that sender's future mail needs no inference. */
  learned: number;
}

/** The cascade for one account, cheapest first. The decision-model tier would slot in before the model. */
function stagesFor(deps: TriageDeps, accountId: string): Stage[] {
  const { db, model } = deps;
  const labels = listLabels(db, accountId);
  const stages = [rulesStage(listRules(db, accountId), labels, { hasWritten: (facts) => cachedCorrespondent(db, facts.accountId, facts.from.address) })];
  if (model) {
    stages.push(
      modelStage({
        judge: model.judge,
        labels,
        guidelines: model.guidelines,
        gather: (facts) => gatherEvidence({ db, ...model.sources, ...(deps.now ? { now: deps.now } : {}) }, facts),
      }),
    );
  }
  return stages;
}

/**
 * Decide every recorded message that has no decision yet and, when a mailbox is given, carry the
 * decisions out. Each decision is recorded before anything is changed; if the change cannot be
 * attempted (a provider error), the decision stays unsettled and the next pass retries it.
 */
export async function triageAccount(deps: TriageDeps, account: Account, limit = 200): Promise<TriageReport> {
  const { db, mailbox } = deps;
  const now = deps.now ?? Date.now;
  const report: TriageReport = { decided: { keep: 0, archive: 0, spam: 0, review: 0 }, acted: 0, skipped: 0, troubled: 0, learned: 0 };

  const carryOut = async (decisionId: number, messageId: string, decision: Pick<Decision, 'disposition' | 'gmailLabel'>, box: Mailbox) => {
    const action = planAction(decision);
    if (!action) {
      settleDecision(db, decisionId, 'none');
      return;
    }
    const outcome = await execute({ db, mailbox: box, now }, account.id, messageId, action, decisionId);
    settleDecision(db, decisionId, outcome.status, outcome.status === 'done' ? null : outcome.reason);
    if (outcome.status === 'done') report.acted++;
    else if (outcome.status === 'skipped') report.skipped++;
    else report.troubled++;
  };

  if (mailbox) {
    for (const pending of listUnsettledDecisions(db, account.id)) await carryOut(pending.id, pending.messageId, pending, mailbox);
  }

  const stages = stagesFor(deps, account.id);
  for (const { facts, observeOnly } of listUndecided(db, account.id, limit)) {
    const act = mailbox !== null && !observeOnly;
    const started = performance.now();
    const decision = await triage(stages, facts);
    const decisionId = recordDecision(db, account.id, facts.messageId, decision, {
      mode: act ? 'act' : 'observe',
      durationMs: Math.round(performance.now() - started),
      now: now(),
    });
    if (decision.ruleId) countRuleHit(db, decision.ruleId);
    if (decision.stage === 'agent' && learnSender(db, account.id, facts.from.address, now())) report.learned++;
    report.decided[decision.disposition]++;
    if (act) await carryOut(decisionId, facts.messageId, decision, mailbox);
  }
  return report;
}
