import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureExamples, parseHeaders } from '../src/daemon/examples.ts';
import { triageAccount } from '../src/daemon/triage.ts';
import { listSuggestions } from '../src/dashboard/queries.ts';
import { createDashboardServer } from '../src/dashboard/server.ts';
import { accuracy, applyFeedback, pendingSuggestions } from '../src/learn/feedback.ts';
import { connectAccount, listAccounts, recordSync } from '../src/store/accounts.ts';
import { openDb } from '../src/store/db.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { addRule, listRules } from '../src/store/rules.ts';
import type { Decision, Disposition } from '../src/triage/types.ts';
import { facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
let db: DatabaseSync;
let serial = 0;

/** Record a message from `address` and what sift would do with it, while observing. */
function suggest(address: string, disposition: Disposition, extra: Partial<Decision> = {}): number {
  const id = `m${++serial}`;
  recordSync(
    db,
    ACCOUNT,
    [facts({ accountId: ACCOUNT, messageId: id, from: { address, domain: address.split('@')[1] ?? '' }, subject: `Subject ${id}` })],
    '2',
  );
  return recordDecision(db, ACCOUNT, id, { disposition, subscription: 'preserve', stage: 'agent', reason: 'looks like it', ...extra }, { now: serial });
}

beforeEach(() => {
  db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
  serial = 0;
});

/** The rule sift holds for one sender, without its bookkeeping. */
const ruleFor = (address: string) =>
  listRules(db, ACCOUNT)
    .filter((r) => r.match.from === address)
    .map(({ labelId, disposition, source }) => ({ labelId, ...(disposition ? { disposition } : {}), source }));

const NEWS = { labelId: 'newsletter', gmailLabel: 'sift/newsletters' } as const;

describe('suggestions', () => {
  it('are the current decision for each message made while observing, newest first', () => {
    suggest('news@example.com', 'archive', NEWS);
    const second = suggest('news@example.com', 'archive', NEWS);
    recordDecision(
      db,
      ACCOUNT,
      'm2',
      { disposition: 'keep', subscription: 'preserve', stage: 'agent', reason: 'changed its mind', labelId: 'personal' },
      { now: 9 },
    );
    recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'acted' })], '3');
    recordDecision(db, ACCOUNT, 'acted', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r' }, { mode: 'act' });

    const pending = pendingSuggestions(db);
    expect(pending.map((s) => [s.messageId, s.disposition, s.labelId])).toEqual([
      ['m2', 'keep', 'personal'],
      ['m1', 'archive', 'newsletter'],
    ]);
    expect(pending.map((s) => s.decisionId)).not.toContain(second);
  });

  it("leave out what a rule of the user's decided, but not what a rule sift learned did", () => {
    const mine = addRule(db, ACCOUNT, { match: { from: 'rule@example.com' }, labelId: 'newsletter' }, 'user');
    const corrected = addRule(db, ACCOUNT, { match: { from: 'taught@example.com' }, labelId: 'newsletter' }, 'correction');
    const learned = addRule(db, ACCOUNT, { match: { from: 'learned@example.com' }, labelId: 'newsletter' }, 'agent');
    suggest('rule@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: mine });
    suggest('taught@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: corrected });
    suggest('learned@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: learned });
    suggest('gone@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: 'r-removed' });
    expect(pendingSuggestions(db).map((s) => s.fromAddress)).toEqual(['learned@example.com']);
  });

  it('are grouped by sender, label and what sift would do, biggest first, without kept mail unless asked', () => {
    suggest('a@example.com', 'archive', NEWS);
    suggest('b@example.com', 'archive', NEWS);
    suggest('b@example.com', 'archive', NEWS);
    suggest('b@example.com', 'archive', { labelId: 'marketing' });
    suggest('b@example.com', 'review');
    suggest('c@example.com', 'keep', { labelId: 'personal' });

    const { groups, waiting, labels } = listSuggestions(db);
    expect(waiting).toBe(5);
    expect(groups.map((g) => [g.sender, g.labelName, g.disposition, g.messages])).toEqual([
      ['b@example.com', 'Newsletters', 'archive', 2],
      ['b@example.com', null, 'review', 1],
      ['b@example.com', 'Marketing', 'archive', 1],
      ['a@example.com', 'Newsletters', 'archive', 1],
    ]);
    expect(groups[0]?.sample.map((m) => m.subject)).toEqual(['Subject m3', 'Subject m2']);
    expect(labels[ACCOUNT]).toContainEqual({ id: 'newsletter', name: 'Newsletters', disposition: 'archive' });
    expect(listSuggestions(db, { includeKept: true }).waiting).toBe(6);
  });
});

describe('teaching', () => {
  it('agreeing settles everything from the sender and makes a rule: the sender is that label', () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    suggest('other@example.com', 'archive', NEWS);

    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' }, 50);
    expect(result).toEqual({ reviewed: 2, taught: 'From now on, mail from news@example.com is Newsletters: archived.' });
    expect(ruleFor('news@example.com')).toEqual([{ labelId: 'newsletter', source: 'user' }]);
    expect(pendingSuggestions(db).map((s) => s.fromAddress)).toEqual(['other@example.com']);
    expect(accuracy(db)).toMatchObject({ reviewed: 2, right: 2 });
  });

  it('naming a different label corrects sift: the rule comes from the correction and it counts against sift', () => {
    suggest('ada@example.org', 'archive', { labelId: 'marketing' });
    suggest('ada@example.org', 'keep', { labelId: 'personal' });
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'ada@example.org', label: 'personal', scope: 'sender' }, 50);

    expect(result.taught).toBe('From now on, mail from ada@example.org is Personal: kept in your inbox.');
    expect(ruleFor('ada@example.org')).toEqual([{ labelId: 'personal', source: 'correction' }]);
    expect(db.prepare('SELECT verdict, correct, label_id FROM feedback ORDER BY id').all()).toEqual([
      { verdict: 'right', correct: null, label_id: 'personal' },
      { verdict: 'wrong', correct: 'keep', label_id: 'personal' },
    ]);
    expect(accuracy(db)).toMatchObject({ reviewed: 2, right: 1 });
  });

  it('an exception keeps the label but does something else for that sender', () => {
    suggest('digest@example.com', 'archive', NEWS);
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'digest@example.com', label: 'newsletter', disposition: 'keep', scope: 'sender' });
    expect(result.taught).toBe('From now on, mail from digest@example.com is Newsletters: kept in your inbox.');
    expect(ruleFor('digest@example.com')).toEqual([{ labelId: 'newsletter', disposition: 'keep', source: 'user' }]);
    // sift had the label right, so it is not a mistake.
    expect(accuracy(db)).toMatchObject({ reviewed: 1, right: 1 });
  });

  it('answering mail sift could not place teaches the sender without counting as a mistake', () => {
    suggest('cold@example.net', 'review');
    applyFeedback(db, { accountId: ACCOUNT, sender: 'cold@example.net', label: 'marketing', scope: 'sender' });
    expect(db.prepare('SELECT verdict, correct FROM feedback').get()).toEqual({ verdict: 'answered', correct: 'archive' });
    expect(accuracy(db)).toMatchObject({ reviewed: 0, right: 0 });
    expect(ruleFor('cold@example.net')).toEqual([{ labelId: 'marketing', source: 'correction' }]);
  });

  it('a label set to be left for the user keeps the mail in the inbox', () => {
    suggest('pitch@example.net', 'archive', { labelId: 'marketing' });
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'pitch@example.net', label: 'cold_outreach', scope: 'sender' });
    expect(result.taught).toBe('From now on, mail from pitch@example.net is Cold outreach: left for you.');
    expect(db.prepare('SELECT disposition, label_id FROM examples').get()).toEqual({ disposition: 'keep', label_id: 'cold_outreach' });
  });

  it('an answer about one message is recorded but makes no rule', () => {
    const decisionId = suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'message', decisionId });
    expect(result).toEqual({ reviewed: 1, taught: null });
    expect(listRules(db, ACCOUNT)).toEqual([]);
    expect(pendingSuggestions(db)).toHaveLength(1);
  });

  it("the user's answer replaces a rule sift learned for the sender, and decides later mail without a model", async () => {
    const learned = addRule(db, ACCOUNT, { match: { from: 'news@example.com' }, labelId: 'newsletter' }, 'agent');
    suggest('news@example.com', 'archive', { ...NEWS, stage: 'rules', ruleId: learned });
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'personal', scope: 'sender' });
    expect(listRules(db, ACCOUNT)).toMatchObject([{ id: learned, labelId: 'personal', source: 'correction' }]);
    expect(listRules(db, ACCOUNT)[0]).not.toHaveProperty('learned');

    recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'later' })], '4');
    let modelCalls = 0;
    const model = {
      judge: async () => (modelCalls++, null),
      guidelines: '',
      sources: { api: { getBodyText: async () => null }, mailbox: { hasSentTo: async () => false } },
    };
    await triageAccount({ db, mailbox: null, model }, listAccounts(db)[0]!);
    expect(db.prepare(`SELECT stage, disposition, label_id FROM decisions WHERE message_id = 'later'`).get()).toEqual({
      stage: 'rules',
      disposition: 'keep',
      label_id: 'personal',
    });
    expect(modelCalls).toBe(0);
    expect(pendingSuggestions(db)).toEqual([]);
  });

  it('rejects a label that does not exist and an answer about nothing that is waiting', () => {
    suggest('news@example.com', 'archive', NEWS);
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'nonsense', scope: 'sender' })).toThrow('no label');
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'nobody@example.com', label: 'newsletter', scope: 'sender' })).toThrow('no longer waiting');
    expect(db.prepare('SELECT count(*) AS n FROM feedback').get()).toEqual({ n: 0 });
    expect(listRules(db, ACCOUNT)).toEqual([]);
  });
});

describe('examples', () => {
  const RAW = Buffer.from('From: News <news@example.com>\r\nSubject: A long\r\n subject line\r\nX-Thing: a: b\r\n\r\nHello there.\r\nFrom: not a header\r\n');

  it('reads every header of a raw message, joining folded lines', () => {
    expect(parseHeaders(RAW)).toEqual([
      ['From', 'News <news@example.com>'],
      ['Subject', 'A long subject line'],
      ['X-Thing', 'a: b'],
    ]);
  });

  it('queues each marked message with the answer and what sift had suggested', () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'keep', { labelId: 'personal' });
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' }, 50);
    expect(db.prepare('SELECT message_id, disposition, label_id, suggested, suggested_by, status, raw FROM examples ORDER BY message_id').all()).toEqual([
      { message_id: 'm1', disposition: 'archive', label_id: 'newsletter', suggested: 'archive', suggested_by: 'agent', status: 'pending', raw: null },
      { message_id: 'm2', disposition: 'archive', label_id: 'newsletter', suggested: 'keep', suggested_by: 'agent', status: 'pending', raw: null },
    ]);
  });

  it('stores the whole message on the next pass, and keeps the answer when the message is gone', async () => {
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    suggest('news@example.com', 'archive', NEWS);
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' });

    let failing = true;
    const api = {
      getRaw: async (id: string) => {
        if (id === 'm3' && failing) throw new Error('network');
        return id === 'm2' ? null : RAW;
      },
      getBodyText: async () => 'Hello there.',
    };
    await expect(captureExamples(db, api, ACCOUNT, () => 99)).rejects.toThrow('network');
    const stored = db.prepare('SELECT message_id, status, body_text, headers_json, captured_at, length(raw) AS bytes FROM examples ORDER BY message_id').all();
    expect(stored).toEqual([
      { message_id: 'm1', status: 'captured', body_text: 'Hello there.', headers_json: JSON.stringify(parseHeaders(RAW)), captured_at: 99, bytes: RAW.length },
      { message_id: 'm2', status: 'gone', body_text: null, headers_json: null, captured_at: 99, bytes: null },
      { message_id: 'm3', status: 'pending', body_text: null, headers_json: null, captured_at: null, bytes: null },
    ]);

    failing = false;
    expect(await captureExamples(db, api, ACCOUNT)).toBe(1);
    expect(await captureExamples(db, api, ACCOUNT)).toBe(0);
    expect(listSuggestions(db).examples).toEqual({ captured: 2, pending: 0 });
  });
});

describe('feedback endpoint', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  async function start() {
    const assets = mkdtempSync(join(tmpdir(), 'sift-web-'));
    mkdirSync(join(assets, 'assets'));
    writeFileSync(join(assets, 'index.html'), '<!doctype html>');
    const server = createDashboardServer(db, { assetsDir: assets, allowedHosts: ['maximus'], now: () => 77 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => server.close();
    return (server.address() as AddressInfo).port;
  }

  function post(port: number, body: unknown, headers: Record<string, string> = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const req = request(
        {
          port,
          path: '/api/feedback',
          method: 'POST',
          headers: { host: `localhost:${port}`, origin: `http://localhost:${port}`, 'content-type': 'application/json', 'x-sift': '1', ...headers },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += String(chunk)));
          res.on('end', () => {
            let body: Record<string, unknown> = {};
            try {
              body = JSON.parse(data) as Record<string, unknown>;
            } catch {
              body = { text: data };
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.on('error', reject);
      req.end(text);
    });
  }

  const answer = { accountId: ACCOUNT, sender: 'news@example.com', label: 'newsletter', scope: 'sender' };

  it('records an answer sent by the dashboard page and reports what was learned', async () => {
    suggest('news@example.com', 'archive', NEWS);
    const port = await start();
    expect(await post(port, answer)).toEqual({
      status: 200,
      body: { reviewed: 1, taught: 'From now on, mail from news@example.com is Newsletters: archived.' },
    });
    expect(db.prepare('SELECT created_at FROM feedback').get()).toEqual({ created_at: 77 });
    const suggestions = (await (await fetch(`http://localhost:${port}/api/suggestions`)).json()) as { waiting: number; accuracy: unknown };
    expect(suggestions).toMatchObject({ waiting: 0, accuracy: { reviewed: 1, right: 1 }, examples: { captured: 0, pending: 1 } });
    expect((suggestions as unknown as { labels: Record<string, { id: string }[]> }).labels[ACCOUNT]?.map((l) => l.id)).toContain('newsletter');
  });

  it("accepts the page when it is opened by one of the machine's own names", async () => {
    suggest('news@example.com', 'archive', NEWS);
    const port = await start();
    expect((await post(port, answer, { host: `maximus:${port}`, origin: `http://maximus:${port}` })).status).toBe(200);
  });

  it('refuses a write that did not come from the dashboard page', async () => {
    suggest('news@example.com', 'archive', NEWS);
    const port = await start();
    expect((await post(port, answer, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(port, answer, { origin: '' })).status).toBe(403);
    expect((await post(port, answer, { 'x-sift': '' })).status).toBe(403);
    expect((await post(port, answer, { 'content-type': 'text/plain' })).status).toBe(403);
    expect((await post(port, answer, { host: 'evil.example' })).status).toBe(403);
    expect(db.prepare('SELECT count(*) AS n FROM feedback').get()).toEqual({ n: 0 });
  });

  it('refuses malformed answers and ones about nothing waiting', async () => {
    suggest('news@example.com', 'archive', NEWS);
    const port = await start();
    expect((await post(port, '{not json')).status).toBe(400);
    expect((await post(port, { ...answer, label: undefined })).status).toBe(400);
    expect((await post(port, { ...answer, disposition: 'delete' })).status).toBe(400);
    expect((await post(port, { ...answer, disposition: 'review' })).status).toBe(400);
    expect((await post(port, { ...answer, label: 'DROP TABLE' })).status).toBe(400);
    expect((await post(port, { ...answer, label: 'nonsense' })).status).toBe(409);
    expect((await post(port, { ...answer, scope: 'message' })).status).toBe(400);
    expect((await post(port, { ...answer, filler: 'x'.repeat(20_000) })).status).toBe(400);
    expect((await post(port, { ...answer, sender: 'nobody@example.com' })).status).toBe(409);
    expect((await fetch(`http://localhost:${port}/api/summary`, { method: 'POST' })).status).toBe(405);
  });
});
