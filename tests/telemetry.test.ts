import { type Api, type Model, type Models, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createJudge } from '../src/model/judge.ts';
import { connectAccount, listAccounts, recordSync } from '../src/store/accounts.ts';
import { hashOf, traceIds } from '../src/store/content.ts';
import { VERDICT_TOOL } from '../src/triage/prompt.ts';
import { deriveFacts } from '../src/triage/facts.ts';
import { loadKeyring } from '../src/secrets.ts';
import { flushTelemetry, reportError, scrub, startTelemetry, traced } from '../src/telemetry.ts';
import { triageAccount } from '../src/work/triage.ts';
import { freshStore, raw } from './fixtures.ts';
import { facts, SAMPLE_LABELS, withSampleLabels } from './helpers.ts';

const ACCOUNT = 'me@example.org';
const SENDER = 'billing@shop.example.com';
const SUBJECT = 'Your invoice 8812 is overdue';
const BODY = 'Pay 4,200 by Friday or your account at Acme closes.';
const REASON = 'An overdue invoice from Acme.';

type Span = { name: string; attributes: Record<string, { value: unknown }> };
type Envelope = [unknown, [{ type: string }, unknown][]];

/** Everything sent to Sentry, as the transport was handed it. */
const sent: Envelope[] = [];

beforeAll(() => {
  startTelemetry('https://key@o0.ingest.example.org/1', {
    transport: () => ({ send: async (envelope) => (sent.push(envelope), {}), flush: async () => true }),
  });
});
beforeEach(() => void sent.splice(0));

/** Spans and events sent so far, after waiting for them. */
async function delivered() {
  await flushTelemetry();
  const items = sent.flatMap(([, items]) => items);
  const spans = items.filter(([header]) => header.type === 'span').flatMap(([, body]) => (body as { items: Span[] }).items);
  const events = items.filter(([header]) => header.type === 'event').map(([, body]) => body);
  const attributes = (name: string) => {
    const span = spans.find((s) => s.name === name);
    if (!span) throw new Error(`no span ${name} in ${spans.map((s) => s.name).join(', ')}`);
    return Object.fromEntries(Object.entries(span.attributes).map(([key, { value }]) => [key, value]));
  };
  return { spans, events, attributes, text: JSON.stringify(sent) };
}

/** A person's database with a key, so hashes are hashes. */
async function keyedPerson() {
  const store = await freshStore(loadKeyring({ SIFT_KEY: 'telemetry-key' }));
  const db = await store.user(await connectAccount(store, ACCOUNT, '1', 0));
  const other = await store.user(await connectAccount(store, 'you@example.org', '1', 0));
  await withSampleLabels(db, ACCOUNT);
  return { db, other };
}

const message = facts({
  accountId: ACCOUNT,
  messageId: 'abc123',
  from: { address: SENDER, domain: 'shop.example.com', name: 'Acme Billing' },
  subject: SUBJECT,
});

/** A provider that answers once, with a verdict and what it cost. */
function answering(): { models: Models; model: Model<Api> } {
  const model = fauxProvider().getModel();
  const answer = {
    ...fauxAssistantMessage([fauxToolCall(VERDICT_TOOL, { reason: REASON, label: 'transactional', confidence: 0.9 })], {
      stopReason: 'toolUse',
      responseId: 'resp_1',
    }),
    usage: {
      input: 900,
      output: 40,
      cacheRead: 100,
      cacheWrite: 0,
      totalTokens: 1040,
      cost: { input: 0.0009, output: 0.0004, cacheRead: 0.00001, cacheWrite: 0, total: 0.00131 },
    },
  };
  return { models: { complete: async () => answer } as unknown as Models, model };
}

describe('the model call, as Sentry is sent it', () => {
  it('carries the model, tokens, cost and how it stopped, under the names Sentry reads, and none of the mail', async () => {
    const { models, model } = answering();
    const verdict = await createJudge(
      models,
      model,
    )({
      evidence: { facts: message, known: deriveFacts(message), body: BODY, sender: { messagesSeen: 1, userHasWritten: false } },
      labels: SAMPLE_LABELS,
    });
    expect(verdict).toMatchObject({ label: 'transactional' });

    const { spans, attributes, text } = await delivered();
    expect(attributes(`chat ${model.id}`)).toMatchObject({
      'sentry.op': 'gen_ai.chat',
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': model.provider,
      'gen_ai.request.model': model.id,
      'gen_ai.response.finish_reasons': '["tool_call"]',
      'gen_ai.usage.input_tokens': 1000,
      'gen_ai.usage.cache_read.input_tokens': 100,
      'gen_ai.usage.output_tokens': 40,
      'gen_ai.usage.total_tokens': 1040,
      'gen_ai.cost.input_tokens': expect.closeTo(0.00091, 8),
      'gen_ai.cost.output_tokens': 0.0004,
      'gen_ai.cost.total_tokens': 0.00131,
    });
    expect(attributes(`execute_tool ${VERDICT_TOOL}`)).toMatchObject({ 'sentry.op': 'gen_ai.execute_tool', 'gen_ai.tool.name': VERDICT_TOOL });
    expect(spans).toHaveLength(2);
    for (const content of [SUBJECT, BODY, REASON, SENDER, 'Acme Billing', 'transactional', 'shop.example.com']) expect(text).not.toContain(content);
  });

  it('is found by the run it was recorded as, and its message by keyed hashes', async () => {
    const { db } = await keyedPerson();
    await recordSync(db, ACCOUNT, [message], '2', 0);
    const { models, model } = answering();
    const sources = { api: { getContent: async () => null, getThread: async () => null }, mailbox: { hasSentTo: async () => false } };
    await triageAccount({ db, mailbox: null, model: { judge: createJudge(models, model), model: 'faux/model' }, sources }, (await listAccounts(db))[0]!);

    const { attributes, text } = await delivered();
    const run = await raw(db).get<{ id: number }>('SELECT id FROM model_runs');
    const decision = await raw(db).get<{ id: number; disposition: string }>('SELECT id, disposition FROM decisions');
    const ids = { 'sift.message': hashOf(db, 'abc123'), 'sift.sender': hashOf(db, SENDER), 'sift.domain': hashOf(db, 'shop.example.com') };
    expect(attributes('triage')).toMatchObject({ ...ids, 'sift.decision_id': decision!.id, 'sift.stage': 'model' });
    expect(attributes('invoke_agent triage')).toMatchObject({ ...ids, 'sentry.op': 'gen_ai.invoke_agent', 'sift.run_id': run!.id });
    expect(attributes(`chat ${model.id}`)).toMatchObject({ ...ids, 'sift.run_id': run!.id });
    expect(attributes('model')).toMatchObject({ 'sentry.op': 'sift.tier', 'sift.outcome': decision!.disposition });
    for (const content of [SUBJECT, SENDER, 'abc123']) expect(text).not.toContain(content);
  });
});

describe('the hashes a trace names a message by', () => {
  it('are the ones its record is found by, the same each time, and differ for another person', async () => {
    const { db, other } = await keyedPerson();
    const ids = traceIds(db, 'abc123', message.from);
    expect(traceIds(db, 'abc123', message.from)).toEqual(ids);
    expect(ids['sift.sender']).toBe(hashOf(db, SENDER));
    await recordSync(db, ACCOUNT, [message], '2', 0);
    expect(await raw(db).get('SELECT sender_hash, domain_hash FROM messages')).toEqual({ sender_hash: ids['sift.sender'], domain_hash: ids['sift.domain'] });
    expect(Object.values(ids).join(' ')).not.toMatch(/abc123|example/);
    expect(traceIds(other, 'abc123', message.from)['sift.sender']).not.toBe(ids['sift.sender']);
  });

  it('are left out without a key, where a hash would be the address itself', async () => {
    const store = await freshStore();
    const db = await store.user(await connectAccount(store, ACCOUNT, '1', 0));
    expect(traceIds(db, 'abc123', message.from)).toEqual({});
  });
});

describe('the scrubber', () => {
  it('replaces any address, anywhere, except the account the span is for, and drops prompt and answer', () => {
    expect(
      scrub({
        name: `triage for ${SENDER}`,
        attributes: {
          'user.email': { value: ACCOUNT },
          note: { value: `from a%40example.com and <${SENDER}>` },
          'gen_ai.input.messages': { value: BODY },
          'gen_ai.output.messages': { value: REASON },
        },
        list: [[`x ${SENDER}`]],
      }),
    ).toEqual({
      name: 'triage for [address]',
      attributes: { 'user.email': { value: ACCOUNT }, note: { value: 'from [address] and <[address]>' } },
      list: [['x [address]']],
    });
  });

  it('runs on every span and error on the way out', async () => {
    await traced('sift.work', `pass ${SENDER}`, { 'user.email': ACCOUNT, slipped: `sender ${SENDER}`, 'gen_ai.input.messages': BODY }, async () => {
      reportError(new Error(`Gmail refused the change for ${SENDER}`));
    });
    const { events, attributes, text } = await delivered();
    expect(attributes('pass [address]')).toMatchObject({ 'user.email': ACCOUNT, slipped: 'sender [address]' });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).toContain('Gmail refused the change for [address]');
    for (const content of [SENDER, BODY]) expect(text).not.toContain(content);
  });
});
