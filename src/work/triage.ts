import type { Sql } from '../store/sql.ts';
import { archiveEarlier, execute, undo } from '../actions/executor.ts';
import type { Mailbox } from '../actions/mailbox.ts';
import type { UnsubscribeOutcome } from '../actions/unsubscribe.ts';
import { planAction } from '../actions/plan.ts';
import type { Account } from '../store/accounts.ts';
import { traceIds } from '../store/content.ts';
import { examplesFor } from '../store/examples.ts';
import { listLabels } from '../store/labels.ts';
import { listUnsettledDecisions, recordDecision, settleDecision } from '../store/decisions.ts';
import { type QueuedMessage, listUndecided } from '../store/messages.ts';
import { excuseRuns, finishRun, startRun } from '../store/runs.ts';
import { blockSender, countRuleHit, listRules } from '../store/rules.ts';
import { cachedCorrespondent } from '../store/senders.ts';
import { passedDmarc } from '../triage/features.ts';
import { triage } from '../triage/pipeline.ts';
import { priorRule, readsMessage, rulesStage, settle } from '../triage/stages/rules.ts';
import { type Evidence, type Judge, type JudgeFailure, describeFailure, modelStage } from '../triage/stages/model.ts';
import type { Decision, Disposition, MessageFacts, Stage, Unfinished } from '../triage/types.ts';
import { type EvidenceSources, gatherEvidence } from './evidence.ts';
import { type Traced, invokeAgent, reportError, traced } from '../telemetry.ts';
import { changeTries, lastStandingChange } from '../store/actions.ts';

/** How many passes try a mailbox change that did not land. Gmail failing one change is almost always passing, and the user is not asked to look. */
export const CHANGE_TRIES = 3;

/** Read access to the account's mail, for the model's evidence and for rules on what only the whole message shows. It never changes the mailbox. */
type Sources = Omit<EvidenceSources, 'db' | 'now'>;

export type TriageDeps = {
  db: Sql;
  /** Null while Mild is off: decisions are recorded and nothing in the mailbox changes. */
  mailbox: Mailbox | null;
  /** While Mild is off: the mailbox to carry out the user's own answers in. Nothing else is done with it. */
  answers?: Mailbox | null;
  /**
   * Leaves a mailing list. Called for a decision that says to unsubscribe, after its mailbox change has
   * gone through. Omitted in tests and tools that must not reach the network.
   */
  unsubscribe?: (accountId: string, messageId: string) => Promise<UnsubscribeOutcome>;
  now?: () => number;
  /** Start nothing new from this time on; the report says when work was left. */
  until?: number;
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
  /** Changes that did not land, to be tried again on the next pass. */
  retrying: number;
  /** Changes that did not land after `CHANGE_TRIES`, reported and given up on. */
  troubled: number;
  /** Senders blocked this pass. */
  blocked: number;
  /** Mailing lists left this pass. */
  unsubscribed: number;
  /** Messages the model failed on this pass. Each stays in the queue until it has failed `MAX_ATTEMPTS` times on its own account. */
  unjudged: number;
  /** What went wrong the last time. */
  failure?: string;
  /** Stopped at `until` with mail left to decide or carry out. */
  unfinished?: true;
}

/** After this many provider errors in a row a pass stops asking the model: the provider is likely down. */
const FAILURES_IN_A_ROW = 3;

/**
 * The cascade for one account, as a function that decides one message: the tiers cheapest first, then
 * the rules that wait for a label. Once `asking` turns false, mail that needs the model is left unfinished
 * without asking, rather than given to a rule that would have deferred to it. When a rule asks what only
 * the whole message shows (an attachment), each message is read before the rules, model or not.
 */
async function cascadeFor(deps: TriageDeps, asking: () => boolean = () => true): Promise<(facts: MessageFacts) => Promise<Decision | Unfinished>> {
  const { db, model, sources } = deps;
  const labels = await listLabels(db);
  const rules = await listRules(db);
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
      examples: async (facts) => await examplesFor(db, facts, labels),
    });
    stages.push({ name: stage.name, decide: async (facts) => (asking() ? await stage.decide(facts) : { unfinished: 'the model was not asked' }) });
  }
  const tiers = stages.map((stage): Stage<Decision | Unfinished> => ({
    name: stage.name,
    decide: (facts) =>
      traced('sift.tier', stage.name, {}, async (span) => {
        const result = await stage.decide(facts);
        span.set({ 'sift.outcome': result === null ? 'abstained' : 'unfinished' in result ? 'unfinished' : result.disposition });
        return result;
      }),
  }));
  return async (facts) => {
    evidence = undefined;
    await read(facts);
    const message = gather && reading && facts.known?.hasAttachments === undefined ? { ...facts, known: (await gather(facts)).known } : facts;
    // Reading the message for the model may have added to what is known about it.
    const settled = async () => (evidence ? { ...facts, known: (await evidence).known } : message);
    return await triage(tiers, message, async (decision) => (await read(facts), settle(rules, labels, await settled(), decision, options)));
  };
}

export const emptyReport = (): TriageReport => ({
  decided: { keep: 0, archive: 0, spam: 0, review: 0 },
  acted: 0,
  skipped: 0,
  retrying: 0,
  troubled: 0,
  blocked: 0,
  unsubscribed: 0,
  unjudged: 0,
});

/**
 * Decide every recorded message that has no decision yet and, when a mailbox is given, carry the
 * decisions out. Each decision is recorded before anything is changed; if the change cannot be
 * attempted (a provider error), the decision stays unsettled and the next pass retries it. Every model
 * call is recorded as a run; one that fails decides nothing, so the message is asked about again next pass.
 */
export async function triageAccount(deps: TriageDeps, account: Account, limit = 200): Promise<TriageReport> {
  const report = emptyReport();
  const carryOut = carrier(deps, account, report);
  const box = deps.mailbox ?? deps.answers;
  if (box)
    for (const pending of await listUnsettledDecisions(deps.db, account.id, deps.mailbox ? {} : { byUserOnly: true })) {
      if (over(deps, report)) break;
      await carryOut(pending.id, pending.messageId, pending, box);
    }
  const decider = await deciderFor(deps, account, report);
  for (const listed of await listUndecided(deps.db, account.id, limit)) {
    if (over(deps, report)) break;
    await decider.decide(listed);
  }
  await decider.done();
  return report;
}

/** Whether `until` has passed; the report then says work was left. */
function over(deps: Pick<TriageDeps, 'now' | 'until'>, report: TriageReport): boolean {
  if (deps.until === undefined || (deps.now ?? Date.now)() < deps.until) return false;
  report.unfinished = true;
  return true;
}

/** Where carrying a decision out got to: `retrying` is left unsettled for the next pass, `troubled` settled failed after its last try. */
interface Carried {
  status: 'none' | 'done' | 'skipped' | 'retrying' | 'troubled';
  /** The change made in Gmail, for Undo. */
  actionId?: number;
}

/**
 * Carries a recorded decision out in `box` and settles it. One that did not land is left unsettled while it has tries
 * left, so the next pass asks again, from the labels as they are then.
 */
export async function carryOutDecision(
  deps: { db: Sql; now?: () => number },
  accountId: string,
  decisionId: number,
  messageId: string,
  decision: Pick<Decision, 'disposition' | 'gmailLabel' | 'markRead'>,
  box: Mailbox,
): Promise<Carried> {
  const { db } = deps;
  const action = planAction(decision);
  if (!action) {
    await settleDecision(db, decisionId, 'none');
    return { status: 'none' };
  }
  const outcome = await execute({ db, mailbox: box, now: deps.now ?? Date.now }, accountId, messageId, action, decisionId);
  if (outcome.status === 'failed' || outcome.status === 'unknown') {
    const { tries } = await changeTries(db, decisionId);
    if (tries < CHANGE_TRIES) return { status: 'retrying' };
    reportError(new Error(`A change was not made after ${tries} tries: ${outcome.reason}`));
    await settleDecision(db, decisionId, 'failed', outcome.reason);
    return { status: 'troubled' };
  }
  if (outcome.status === 'done') {
    await settleDecision(db, decisionId, 'done');
    return { status: 'done', actionId: outcome.actionId };
  }
  // An earlier try that could not be read back may have landed after all, leaving nothing to do now.
  const landed = (await changeTries(db, decisionId)).landed;
  await settleDecision(db, decisionId, landed ? 'done' : 'skipped', landed ? null : outcome.reason);
  return { status: landed ? 'done' : 'skipped' };
}

/** `carryOutDecision`, counting what happened in `report`. */
function carrier(deps: TriageDeps, account: Account, report: TriageReport) {
  return async (decisionId: number, messageId: string, decision: Pick<Decision, 'disposition' | 'gmailLabel' | 'markRead'>, box: Mailbox) => {
    const carried = await carryOutDecision(deps, account.id, decisionId, messageId, decision, box);
    if (carried.status === 'retrying') report.retrying++;
    else if (carried.status === 'troubled') report.troubled++;
    else if (carried.status === 'done') report.acted++;
    else if (carried.status === 'skipped') report.skipped++;
    // While Mild is off it changes only the message the person answered.
    if (decision.disposition === 'archive' && deps.mailbox && carried.status === 'done') {
      const archived = carried.actionId ?? (await lastStandingChange(deps.db, account.id, messageId))?.id;
      if (archived !== undefined) await archiveEarlier({ db: deps.db, mailbox: box, now: deps.now ?? Date.now }, account.id, messageId, archived);
    }
    return carried.status === 'retrying' || carried.status === 'troubled' ? 'failed' : carried.status;
  };
}

/**
 * What a message was decided before, for deciding it again: `carriedOut` when Mild's change to it stands in
 * Gmail, which is taken back before a different decision is carried out.
 */
export interface Prior {
  decision: Pick<Decision, 'disposition' | 'labelId' | 'markRead'>;
  carriedOut: boolean;
}

/** What became of one message: `held` when the model was not asked (the provider is down), so it is to be tried again. */
export type Decided = 'decided' | 'unjudged' | 'held' | 'waits';

/**
 * Decides one message after another, as a pass does: the cascade, the model's run recorded, the decision
 * recorded and, where it may be, carried out. Its own state (the run being asked, the provider's errors in a
 * row) is its own, so several can work side by side.
 */
export async function deciderFor(
  deps: TriageDeps,
  account: Account,
  report: TriageReport,
): Promise<{ decide: (listed: QueuedMessage, prior?: Prior) => Promise<Decided>; done: () => Promise<void> }> {
  const { db, mailbox } = deps;
  const now = deps.now ?? Date.now;
  const carryOut = carrier(deps, account, report);

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
      const run = await startRun(db, { accountId, messageId, model: tier.model, ...(input.checks ? { ruleId: input.checks } : {}), now: now() });
      // The run's id is on the agent's span and, carried, on the model call's: a trace finds its row in `model_runs`.
      const verdict = await invokeAgent('triage', [db.person, run], { 'sift.run_id': run }, () =>
        tier.judge(input).catch((error: unknown): JudgeFailure => ({ failed: describeFailure(error) })),
      );
      const usage = verdict.usage ? { usage: verdict.usage } : {};
      await finishRun(db, run, { ...('failed' in verdict ? { error: verdict.failed } : {}), ...usage, now: now() });
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
  const box = mailbox ?? deps.answers;

  const { model: _given, ...modelless } = deps;
  const decide = await cascadeFor(model ? { ...deps, model } : modelless, () => asking);
  // Mail the model failed on every time it was asked is not asked again: a rule may still say what it is, and otherwise
  // it is the user's to say, like any mail no tier could place.
  const decideByRules = await cascadeFor(modelless);
  const unjudged = (decision: Decision | Unfinished): Decision | Unfinished =>
    'unfinished' in decision || decision.stage !== 'fallback' ? decision : { ...decision, reason: 'the model failed on it each time it was asked' };

  // Mild's change from before stands: take it back first, unless the new decision would make the same one.
  const carryOver = async (decisionId: number, messageId: string, decision: Decision, into: Mailbox, prior: Prior | undefined) => {
    if (!prior?.carriedOut) return await carryOut(decisionId, messageId, decision, into);
    const { disposition, labelId, markRead } = prior.decision;
    if (disposition === decision.disposition && (labelId ?? null) === (decision.labelId ?? null) && Boolean(markRead) === Boolean(decision.markRead)) {
      await settleDecision(db, decisionId, 'none');
      return 'none';
    }
    const last = await lastStandingChange(db, account.id, messageId);
    if (last) await undo({ db, mailbox: into, now }, last.id);
    return await carryOut(decisionId, messageId, decision, into);
  };

  // One span per message: what each tier made of it, the model's call, and what was changed in the mailbox.
  const decideOne = async ({ facts, suggestOnly, applyRule, outOfTries }: QueuedMessage, prior: Prior | undefined, span: Traced): Promise<Decided> => {
    const started = performance.now();
    runId = undefined;
    const decision = outOfTries ? unjudged(await decideByRules(facts)) : await decide(facts);
    if ('unfinished' in decision) {
      span.set({ 'sift.outcome': 'unfinished' });
      // Not asked, because the provider is down: it stays in the queue, unrecorded, for the next pass.
      if (runId === undefined) return 'held';
      report.unjudged++;
      report.failure = decision.unfinished;
      if (errors.length >= FAILURES_IN_A_ROW) {
        await excuseRuns(db, errors, now());
        errors = [];
        asking = false;
      }
      return 'unjudged';
    }
    // With no model, mail no rule covers is not anyone's to answer yet: it stays in the queue, unrecorded, for a
    // model once one is connected, or a rule added meanwhile. A model's own "unsure" is recorded and asked about.
    if (decision.stage === 'fallback' && !model && !outOfTries) return 'waits';
    // The user applied this rule to their inbox and the model has now said what the mail is: theirs to carry out, Mild on or off.
    const pressed = applyRule !== null && decision.ruleId === applyRule && Boolean(box);
    const into = pressed ? box : suggestOnly ? null : mailbox;
    const act = Boolean(into);
    const decisionId = await recordDecision(db, account.id, facts.messageId, decision, {
      carryOut: act,
      byUser: pressed,
      durationMs: Math.round(performance.now() - started),
      now: now(),
      ...(runId === undefined ? {} : { runId }),
    });
    span.set({ 'sift.stage': decision.stage, 'sift.disposition': decision.disposition, 'sift.decision_id': decisionId });
    if (decision.ruleId) await countRuleHit(db, decision.ruleId);
    report.decided[decision.disposition]++;
    const status = into ? await carryOver(decisionId, facts.messageId, decision, into, prior) : null;
    // Blocking acts on the sender's address, so the address must be proven: a message that only claims to be
    // from someone would otherwise get that someone blocked. And only once the message itself was marked spam.
    if (
      status === 'done' &&
      decision.block &&
      decision.labelId &&
      passedDmarc(facts.headers) &&
      (await blockSender(db, facts.from.address, decision.labelId, now()))
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
    return 'decided';
  };
  return {
    decide: (listed, prior) =>
      traced('sift.triage', 'triage', traceIds(db, listed.facts.messageId, listed.facts.from), (span) => decideOne(listed, prior, span)),
    done: async () => {
      if (!answered) await excuseRuns(db, errors, now());
    },
  };
}
