import { type Models, createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { createJudge } from '../src/model/judge.ts';
import { DEFAULT_LABELS } from '../src/store/labels.ts';
import { deriveFacts } from '../src/triage/facts.ts';
import { facts } from './helpers.ts';

const SECRET = 'Your one-time code is 482913';

/** What the judge records when the provider answers with `errorMessage`, or `complete` throws it, about a message whose text is SECRET. */
async function failedWith(error: string | Error): Promise<unknown> {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage([], { stopReason: 'error', errorMessage: String(error) })]);
  const throwing = {
    complete: async () => {
      throw error;
    },
  } as unknown as Models;
  const f = facts({ subject: SECRET });
  const verdict = await createJudge(
    typeof error === 'string' ? models : throwing,
    faux.getModel(),
  )({
    evidence: { facts: f, known: deriveFacts(f), body: SECRET, sender: { messagesSeen: 1, userHasWritten: false } },
    labels: DEFAULT_LABELS,
  });
  return (verdict as { failed?: unknown }).failed;
}

describe("a provider's error", () => {
  it('is kept as its status and kind, never in its own words, which can quote the mail', async () => {
    const quoting = (status: number) => `${status} {"error":{"message":"Could not process: ${SECRET}"}}`;
    expect(await failedWith(quoting(429))).toBe('HTTP 429 rate limited');
    expect(await failedWith(quoting(400))).toBe('HTTP 400 bad request');
    expect(await failedWith(quoting(418))).toBe('HTTP 418 refused');
    expect(await failedWith(`OpenAI error (503): ${SECRET}`)).toBe('HTTP 503 unavailable');
    expect(await failedWith('Request timed out.')).toBe('timeout');
    expect(await failedWith('Connection error.: connect ECONNREFUSED 10.0.0.1:443')).toBe('network error');
    expect(await failedWith(`The model refused: ${SECRET}`)).toBe('refused by the provider');
    expect(await failedWith(`Something odd about ${SECRET}`)).toBe('provider error');
    expect(await failedWith(Object.assign(new Error(`Upstream said: ${SECRET}`), { status: 500 }))).toBe('HTTP 500 server error');
    expect(await failedWith(new Error(`fetch failed: ${SECRET}`))).toBe('network error');
  });
});
