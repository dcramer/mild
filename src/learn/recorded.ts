import { Refusal } from '../refusal.ts';
import { type Attributes, invokeAgent, reportError } from '../telemetry.ts';
import { type Usage } from '../triage/types.ts';

type Spent = { usage?: Usage; lookups: number; now: number };

/**
 * Ask the person's model for something, its row already started: the row is finished with what came of the call and
 * what it cost, a throw included. A failure rejects as a Refusal, which the page shows and which is not reported, so it
 * is reported here: a model that keeps failing is Mild's to fix.
 */
export async function recordedAsk<T extends object>(call: {
  agent: string;
  conversation: readonly (number | null)[];
  attributes: Attributes;
  ask: () => Promise<(T | { failed: string }) & { usage?: Usage; lookups?: number }>;
  finish: (outcome: T | { error: string }, spent: Spent) => Promise<void>;
  /** What Sentry is told, before the failure's words. */
  report: string;
  refusal: (failed: string) => string;
  now: () => number;
}): Promise<T> {
  const answer = await invokeAgent(call.agent, call.conversation, call.attributes, async () => {
    try {
      return await call.ask();
    } catch (error) {
      // A look-up that threw: the call still ends on the record, as one that failed.
      await call.finish({ error: error instanceof Error ? error.message : String(error) }, { lookups: 0, now: call.now() });
      throw error;
    }
  });
  const { usage, lookups = 0, ...rest } = answer;
  const said = rest as T | { failed: string };
  const spent = { lookups, ...(usage ? { usage } : {}), now: call.now() };
  if ('failed' in said) {
    await call.finish({ error: said.failed }, spent);
    reportError(new Error(`${call.report}: ${said.failed}`));
    throw new Refusal(call.refusal(said.failed));
  }
  await call.finish(said, spent);
  return said;
}
