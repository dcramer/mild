import { describe, expect, it } from 'vitest';
import { approx, atApiPrices, costLine, costName, costOfMessages, planOf, priceNote, spentLine, subscription } from '../web/src/lib/prices.ts';

const CHATGPT = { provider: 'openai-codex', label: 'ChatGPT', how: 'device-code' } as const;
const KEY = { provider: 'anthropic', label: 'Anthropic API key', how: 'key' } as const;
const choices = [CHATGPT, KEY];

describe('what sums of money say', () => {
  it('knows a model through a plan from one behind a key, for the model in use and for one call', () => {
    expect(subscription({ choices, chosen: 'openai-codex/gpt-5.6-luna' })).toBe(CHATGPT);
    expect(subscription({ choices, chosen: 'anthropic/claude-haiku-4-5' })).toBeNull();
    expect(subscription({ choices, chosen: null })).toBeNull();
    expect(planOf('openai-codex/gpt-5.6-luna', choices)).toBe(CHATGPT);
    // A call made before switching to ChatGPT was paid for.
    expect(planOf('anthropic/claude-haiku-4-5', choices)).toBeNull();
    expect(planOf('', choices)).toBeNull();
  });

  it('says a sum through a plan is an API price the plan covers, and a paid one plainly', () => {
    expect(approx(4.2, CHATGPT)).toBe('≈$4.20');
    expect(approx(4.2, null)).toBe('$4.20');
    expect(costName(CHATGPT)).toBe('Model cost at API prices');
    expect(costName(null)).toBe('Model cost');
    expect(atApiPrices(CHATGPT)).toBe('At API prices, which your ChatGPT plan covers.');
    expect(costLine(CHATGPT, { m: 0.4 }, 'm')).toBe('About $0.40 per 1,000 messages at API prices, which your ChatGPT plan covers.');
    expect(costLine(KEY, { m: 0.4 }, 'm')).toBe('About $0.40 per 1,000 messages.');
    expect(costLine(KEY, {}, 'm')).toBeNull();
    expect(costOfMessages(3.1, CHATGPT)).toBe('About $3.10 at API prices, which your ChatGPT plan covers.');
    expect(costOfMessages(3.1, null)).toBe('Going through them costs about $3.10.');
    expect(spentLine(4.2, 1234, CHATGPT)).toBe('$4.20 at API prices in the last 30 days, for 1,234 messages, which your ChatGPT plan covers.');
    expect(spentLine(4.2, 1, null)).toBe('$4.20 in the last 30 days, for 1 message.');
    expect(priceNote('openai-codex/gpt-5.6-luna', CHATGPT)).toBe('on gpt-5.6-luna, at API prices');
    expect(priceNote(null, CHATGPT)).toBe('at API prices');
    expect(priceNote('anthropic/claude-haiku-4-5', null)).toBe('on claude-haiku-4-5');
  });
});
