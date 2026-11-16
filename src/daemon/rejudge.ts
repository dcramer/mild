import { predatingGuidelines } from '../learn/redecide.ts';
import type { Account } from '../store/accounts.ts';
import { recordDecision } from '../store/decisions.ts';
import { getFacts } from '../store/messages.ts';
import { countRuleHit } from '../store/rules.ts';
import { triage } from '../triage/pipeline.ts';
import { type TriageDeps, stagesFor } from './triage.ts';

/** Each is a model call, so one request judges at most this many. */
export const MAX_REJUDGE = 100;

/**
 * Decide again the waiting suggestions that were judged before `since`, through the whole cascade, and
 * record each new decision as a suggestion. Returns at once; the work goes on in the background, one
 * message at a time, and `done` resolves when it has finished and never rejects. One the model still
 * cannot answer for keeps its old decision, so it is still counted as out of date. Nothing is learned
 * from these: the same message judged twice is not two messages.
 */
export function rejudgeWaiting(deps: TriageDeps, account: Account, since: number): { started: number; remaining: number; done: Promise<void> } {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const waiting = predatingGuidelines(db, since, account.id);
  const batch = waiting.slice(0, MAX_REJUDGE);
  const stages = stagesFor(deps, account.id);
  const work = async () => {
    for (const { messageId } of batch) {
      const facts = getFacts(db, account.id, messageId);
      if (!facts) continue;
      const started = performance.now();
      const decision = await triage(stages, facts);
      if (decision.stage === 'fallback') continue;
      recordDecision(db, account.id, messageId, decision, { mode: 'observe', durationMs: Math.round(performance.now() - started), now: now() });
      if (decision.ruleId) countRuleHit(db, decision.ruleId);
    }
  };
  return { started: batch.length, remaining: waiting.length - batch.length, done: work().catch(() => {}) };
}
