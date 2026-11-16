import type { Decision, MessageFacts, Stage, Unfinished } from './types.ts';

/**
 * Run the cascade cheapest-first. The first stage to decide wins; if none do, the message goes to review.
 * A stage that could not finish ends the cascade with nothing decided. `after` sees a stage's decision
 * before it is returned: it is where rules that wait for a label apply.
 */
export async function triage<R extends Decision | Unfinished = Decision>(
  stages: readonly Stage<R>[],
  facts: MessageFacts,
  after: (decision: Decision) => Decision | Promise<Decision> = (d) => d,
): Promise<Decision | R> {
  for (const stage of stages) {
    const result = await stage.decide(facts);
    if (!result) continue;
    return 'unfinished' in result ? result : await after(result);
  }
  return { disposition: 'review', subscription: 'preserve', stage: 'fallback', reason: 'no stage reached a decision' };
}
