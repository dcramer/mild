import type { Decision, MessageFacts, Stage } from './types.ts';

/**
 * Run the cascade cheapest-first. The first stage to decide wins; if none do, the message goes to review.
 * `after` sees a stage's decision before it is returned: it is where rules that wait for a label apply.
 */
export async function triage(
  stages: readonly Stage[],
  facts: MessageFacts,
  after: (decision: Decision) => Decision | Promise<Decision> = (d) => d,
): Promise<Decision> {
  for (const stage of stages) {
    const decision = await stage.decide(facts);
    if (decision) return await after(decision);
  }
  return { disposition: 'review', subscription: 'preserve', stage: 'fallback', reason: 'no stage reached a decision' };
}
