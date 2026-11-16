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
import { excuseRuns, finishRun, startRun } from '../store/runs.ts';
import { proposeForSender, proposeSettled } from '../store/proposals.ts';
import { blockSender, countRuleHit, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import { passedDmarc } from '../triage/features.ts';
import { triage } from '../triage/pipeline.ts';
import { priorRule, readsMessage, rulesStage, settle } from '../triage/stages/rules.ts';
import { type Evidence, type Judge, type JudgeFailure, describeFailure, modelStage } from '../triage/stages/model.ts';
import type { Decision, Disposition, MessageFacts, Stage, Unfinished } from '../triage/types.ts';
import { type EvidenceSources, gatherEvidence } from './evidence.ts';

/** Read access to the account's mail, for the model's evidence and for rules on what only the whole message shows. It never changes the mailbox. */
type Sources = Omit<EvidenceSources, 'db' | 'now'>;

type TriageDeps = {
  db: Sql;
  /** Null while sift is off: decisions are recorded and nothing in the mailbox changes. */
  mailbox: Mailbox | null;
  /** While sift is off: the mailbox to carry out the user's own answers in. Nothing else is done with it. */
  answers?: Mailbox | null;
  /**
   * Leaves a mailing list. Called for a decision that says to unsubscribe, after its mailbox change has
   * gone through. Omitted in tests and tools that must not reach the network.
   */
  unsubscribe?: (accountId: string, messageId: string) => Promise<UnsubscribeOutcome>;
  now?: () => number;
} & (
  | {
      /** The inference tier. Omitted when no model is configured: mail no rule covers waits, undecided, for one. */
      model: ModelTier;
      sources: Sources;
    }
  | { model?: undefined; sources?: Sources }
);

interface ModelTier {
  judge: Judge;
  /** As each run records it. */
  model: string;
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
  /** Messages the model failed on this pass. Each stays in the queue until it has failed `MAX_ATTEMPTS` times on its own account. */
  unjudged: number;
  /** What went wrong the last time. */
  failure?: string;
}

/** After this many provider errors in a row a pass stops asking the model: the provider is likely down. */
const FAILURES_IN_A_ROW = 3;

/**
 * The cascade for one account, as a function that decides one message: the tiers cheapest first, then
 * the rules that wait for a label. Once `asking` turns false, mail that needs the model is left unfinished
 * without asking, rather than given to a rule that would have deferred to it. When a rule asks what only
 * the whole message shows (an attachment), each message is read before the rules, model or not.
 */
async function cascadeFor(
  deps: TriageDeps,
  accountId: string,
  asking: () => boolean = () => true,
): Promise<(facts: MessageFacts) => Promise<Decision | Unfinished>> {
  const { db, model, sources } = deps;
  const labels = await listLabels(db, accountId);
  const rules = await listRules(db, accountId);
  // The rules ask whether the owner has written to the sender as they rank; the answer is read before
  // each message, and again whenever something in the cascade may have just found out.
  let written: boolean | undefined;
  const options = { hasWritten: () => written };
  const read = async (facts: MessageFacts) => (written = await cachedCorrespondent(db, facts.accountId, facts.from.address));
  const stages: Stage<Decision | Unfinished>[] = [rulesStage(rules, labels, { ...options, judged: model !== undefined })];
  // Gathered at most once per message, whether the rules or the model needed it first.
  let evidence: Promise<Evidence> | undefined;
  const gather = sources && ((facts: MessageFacts) => (evidence ??= gatherEvidence({ db, ...sources, ...(deps.now ? { now: deps.now } : {}) }, facts)));
  const reading = rules.some(readsMessage);
  if (model && gather) {
    const stage = modelStage({
      judge: model.judge,
      labels,
      gather,
      prior: (facts) => {
        const hit = priorRule(rules, labels, facts, options);
        return hit?.label ? { rule: hit.rule, label: hit.label } : null;
      },
      examples: async (facts) => await shotCandidates(db, facts),
    });
    stages.push({ name: stage.name, decide: async (facts) => (asking() ? await stage.decide(facts) : { unfinished: 'the model was not asked' }) });
  }
  return async (facts) => {
    evidence = undefined;
    await read(facts);
    const message = gather && reading && facts.known?.hasAttachments === undefined ? { ...facts, known: (await gather(facts)).known } : facts;
    // Reading the message for the model may have added to what is known about it.
    const settled = async () => (evidence ? { ...facts, known: (await evidence).known } : message);
    return await triage(stages, message, async (decision) => (await read(facts), settle(rules, labels, await settled(), decision, options)));
  };
}

/**
 * Decide every recorded message that has no decision yet and, when a mailbox is given, carry the
 * decisions out. Each decision is recorded before anything is changed; if the change cannot be
 * attempted (a provider error), the decision stays unsettled and the next pass retries it. Every model
 * call is recorded as a run; one that fails decides nothing, so the message is asked about again next pass.
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
    unjudged: 0,
  };

  // Provider errors since the model last answered. Only a failure of the message itself counts against it:
  // an unusable answer, or an error while the model answers other calls in the same pass. The rest are an
  // outage, and are excused (see `excuseRuns`) when the breaker trips or the pass ends with no answer at all.
  let errors: number[] = [];
  let answered = false;
  let asking = true;
  // The run that reached the message being decided, if the model was asked.
  let runId: number | undefined;
  const judged = (tier: ModelTier): ModelTier => ({
    ...tier,
    judge: async (input) => {
      const { accountId, messageId } = input.evidence.facts;
      const run = await startRun(db, { accountId, messageId, model: tier.model, now: now() });
      const verdict = await tier.judge(input).catch((error: unknown): JudgeFailure => ({ failed: describeFailure(error) }));
      const usage = verdict.usage ? { usage: verdict.usage } : {};
      if ('failed' in verdict) await finishRun(db, run, { outcome: 'failed', error: verdict.failed, ...usage, now: now() });
      else await finishRun(db, run, { outcome: 'judged', ...usage, now: now() });
      if ('failed' in verdict && !verdict.unusable) errors.push(run);
      else {
        errors = [];
        answered = true;
      }
      runId = run;
      return verdict;
    },
  });
  const model = deps.model && judged(deps.model);

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

  const { model: _given, ...modelless } = deps;
  const decide = await cascadeFor(model ? { ...deps, model } : modelless, account.id, () => asking);
  for (const { facts, suggestOnly } of await listUndecided(db, account.id, limit)) {
    const act = mailbox !== null && !suggestOnly;
    const started = performance.now();
    runId = undefined;
    const decision = await decide(facts);
    if ('unfinished' in decision) {
      // Not asked, because the provider is down: it stays in the queue, unrecorded, for the next pass.
      if (runId === undefined) continue;
      report.unjudged++;
      report.failure = decision.unfinished;
      if (errors.length >= FAILURES_IN_A_ROW) {
        await excuseRuns(db, errors, now());
        errors = [];
        asking = false;
      }
      continue;
    }
    // With no model, mail no rule covers is not anyone's to answer yet: it stays in the queue, unrecorded, for a
    // model once one is connected, or a rule added meanwhile. A model's own "unsure" is recorded and asked about.
    if (decision.stage === 'fallback' && !model) continue;
    const decisionId = await recordDecision(db, account.id, facts.messageId, decision, {
      carryOut: act,
      durationMs: Math.round(performance.now() - started),
      now: now(),
      ...(runId === undefined ? {} : { runId }),
    });
    if (decision.ruleId) await countRuleHit(db, decision.ruleId);
    if (decision.stage === 'model') {
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
  if (!answered) await excuseRuns(db, errors, now());
  return report;
}
