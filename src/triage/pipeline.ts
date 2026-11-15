import type { Decision, MessageFacts, Stage } from './types.ts';

/** Run the cascade cheapest-first. The first stage to decide wins; if none do, the message goes to review. */
export async function triage(stages: readonly Stage[], facts: MessageFacts): Promise<Decision> {
  for (const stage of stages) {
    const decision = await stage.decide(facts);
    if (decision) return decision;
  }
  return { disposition: 'review', subscription: 'preserve', stage: 'fallback', reason: 'no stage reached a decision' };
}
