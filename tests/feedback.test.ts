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
import { addRule } from '../src/store/rules.ts';
import { lookupSender } from '../src/store/senders.ts';
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

describe('suggestions', () => {
  it('are the current decision for each message made while observing, newest first', () => {
    suggest('news@example.com', 'archive');
    const second = suggest('news@example.com', 'archive');
    recordDecision(db, ACCOUNT, 'm2', { disposition: 'keep', subscription: 'preserve', stage: 'agent', reason: 'changed its mind' }, { now: 9 });
    recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'acted' })], '3');
    recordDecision(db, ACCOUNT, 'acted', { disposition: 'archive', subscription: 'preserve', stage: 'agent', reason: 'r' }, { mode: 'act' });

    const pending = pendingSuggestions(db);
    expect(pending.map((s) => [s.messageId, s.disposition])).toEqual([
      ['m2', 'keep'],
      ['m1', 'archive'],
    ]);
    expect(pending.map((s) => s.decisionId)).not.toContain(second);
  });

  it('leave out what the user already decided: their rules and senders they taught', () => {
    suggest('rule@example.com', 'archive', { stage: 'rules', ruleId: 'r1' });
    suggest('learned@example.com', 'archive', { stage: 'sender' });
    suggest('taught@example.com', 'archive', { stage: 'sender' });
    db.prepare(`INSERT INTO senders (account_id, address, disposition, source, updated_at) VALUES (?, 'learned@example.com', 'archive', 'agent', 0)`).run(
      ACCOUNT,
    );
    db.prepare(`INSERT INTO senders (account_id, address, disposition, source, updated_at) VALUES (?, 'taught@example.com', 'archive', 'user', 0)`).run(
      ACCOUNT,
    );
    expect(pendingSuggestions(db).map((s) => s.fromAddress)).toEqual(['learned@example.com']);
  });

  it('are grouped by sender and what sift would do, biggest first, without kept mail unless asked', () => {
    suggest('a@example.com', 'archive');
    suggest('b@example.com', 'archive', { category: 'newsletter', label: 'sift/newsletters' });
    suggest('b@example.com', 'archive');
    suggest('b@example.com', 'review');
    suggest('c@example.com', 'keep');

    const { groups, waiting } = listSuggestions(db);
    expect(waiting).toBe(4);
    expect(groups.map((g) => [g.sender, g.disposition, g.messages])).toEqual([
      ['b@example.com', 'archive', 2],
      ['b@example.com', 'review', 1],
      ['a@example.com', 'archive', 1],
    ]);
    expect(groups[0]?.sample.map((m) => m.subject)).toEqual(['Subject m3', 'Subject m2']);
    expect(listSuggestions(db, { includeKept: true }).waiting).toBe(5);
  });
});

describe('teaching', () => {
  it('"right" settles everything from the sender and remembers them, keeping the label sift used', () => {
    suggest('news@example.com', 'archive', { category: 'newsletter', label: 'sift/newsletters' });
    suggest('news@example.com', 'archive', { category: 'newsletter', label: 'sift/newsletters' });
    suggest('other@example.com', 'archive');

    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'right', suggested: 'archive', scope: 'sender' }, 50);
    expect(result).toEqual({ reviewed: 2, taught: 'From now on, mail from news@example.com is archived.' });
    expect(lookupSender(db, ACCOUNT, 'news@example.com')).toEqual({
      disposition: 'archive',
      label: 'sift/newsletters',
      category: 'newsletter',
      userHasReplied: false,
    });
    expect(db.prepare(`SELECT source FROM senders WHERE address = 'news@example.com'`).get()).toEqual({ source: 'user' });
    expect(pendingSuggestions(db).map((s) => s.fromAddress)).toEqual(['other@example.com']);
    expect(accuracy(db)).toMatchObject({ reviewed: 2, right: 2 });
  });

  it('a correction teaches the sender the corrected outcome and counts against sift', () => {
    suggest('ada@example.org', 'archive', { label: 'sift/marketing' });
    suggest('ada@example.org', 'keep');
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'ada@example.org', verdict: 'wrong', correct: 'keep', scope: 'sender' }, 50);

    expect(result.taught).toBe('From now on, mail from ada@example.org is kept in your inbox.');
    expect(db.prepare(`SELECT disposition, label, source FROM senders WHERE address = 'ada@example.org'`).get()).toEqual({
      disposition: 'keep',
      label: null,
      source: 'correction',
    });
    expect(db.prepare('SELECT verdict, correct FROM feedback ORDER BY id').all()).toEqual([
      { verdict: 'right', correct: null },
      { verdict: 'wrong', correct: 'keep' },
    ]);
    expect(accuracy(db)).toMatchObject({ reviewed: 2, right: 1 });
  });

  it('answering mail sift was unsure about teaches the sender without counting as a mistake', () => {
    suggest('cold@example.net', 'review');
    applyFeedback(db, { accountId: ACCOUNT, sender: 'cold@example.net', verdict: 'wrong', correct: 'archive', scope: 'sender' });
    expect(db.prepare('SELECT verdict, correct FROM feedback').get()).toEqual({ verdict: 'answered', correct: 'archive' });
    expect(accuracy(db)).toMatchObject({ reviewed: 0, right: 0 });
    expect(lookupSender(db, ACCOUNT, 'cold@example.net')).toMatchObject({ disposition: 'archive' });

    suggest('unsure@example.net', 'review');
    applyFeedback(db, { accountId: ACCOUNT, sender: 'unsure@example.net', verdict: 'right', suggested: 'review', scope: 'sender' });
    expect(lookupSender(db, ACCOUNT, 'unsure@example.net')).toMatchObject({ disposition: 'keep' });
  });

  it('an answer about one message is recorded but teaches nothing lasting', () => {
    const decisionId = suggest('news@example.com', 'archive');
    suggest('news@example.com', 'archive');
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'wrong', correct: 'keep', scope: 'message', decisionId });
    expect(result).toEqual({ reviewed: 1, taught: null });
    expect(lookupSender(db, ACCOUNT, 'news@example.com')).toBeNull();
    expect(pendingSuggestions(db)).toHaveLength(1);
  });

  it('a taught sender overrides what sift learned by itself, and decides later mail without a model', async () => {
    db.prepare(`INSERT INTO senders (account_id, address, disposition, source, updated_at) VALUES (?, 'news@example.com', 'archive', 'agent', 0)`).run(ACCOUNT);
    suggest('news@example.com', 'archive', { stage: 'sender' });
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'wrong', correct: 'keep', scope: 'sender' });

    recordSync(db, ACCOUNT, [facts({ accountId: ACCOUNT, messageId: 'later' })], '4');
    let modelCalls = 0;
    const model = {
      judge: async () => (modelCalls++, null),
      guidelines: '',
      sources: { api: { getBodyText: async () => null }, mailbox: { hasSentTo: async () => false } },
    };
    await triageAccount({ db, mailbox: null, model }, listAccounts(db)[0]!);
    expect(db.prepare(`SELECT stage, disposition FROM decisions WHERE message_id = 'later'`).get()).toEqual({ stage: 'sender', disposition: 'keep' });
    expect(modelCalls).toBe(0);
    expect(pendingSuggestions(db)).toEqual([]);
  });

  it('rejects an incomplete answer and one about nothing that is waiting', () => {
    suggest('news@example.com', 'archive');
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'wrong', scope: 'sender' })).toThrow(
      'needs what should have happened',
    );
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'right', scope: 'sender' })).toThrow('needs the suggestion');
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'nobody@example.com', verdict: 'right', suggested: 'archive', scope: 'sender' })).toThrow(
      'no longer waiting',
    );
    expect(db.prepare('SELECT count(*) AS n FROM feedback').get()).toEqual({ n: 0 });
  });

  it('never suggests about mail a rule decided, so rules are not second-guessed', () => {
    addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, disposition: 'archive' }, 'user');
    suggest('news@example.com', 'archive', { stage: 'rules' });
    expect(listSuggestions(db).waiting).toBe(0);
  });
});

describe('marking by category', () => {
  it('takes what happens from the category setting and remembers the sender under it', () => {
    suggest('news@example.com', 'keep');
    const result = applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'wrong', category: 'newsletter', scope: 'sender' });
    expect(result.taught).toBe('From now on, mail from news@example.com is archived.');
    expect(lookupSender(db, ACCOUNT, 'news@example.com')).toEqual({
      disposition: 'archive',
      label: 'sift/newsletters',
      category: 'newsletter',
      userHasReplied: false,
    });
    expect(db.prepare('SELECT verdict, correct, category FROM feedback').get()).toEqual({ verdict: 'wrong', correct: 'archive', category: 'newsletter' });
  });

  it('keeps mail in the inbox for a category set to be left for the user', () => {
    suggest('pitch@example.net', 'archive');
    applyFeedback(db, { accountId: ACCOUNT, sender: 'pitch@example.net', verdict: 'wrong', category: 'cold_outreach', scope: 'sender' });
    expect(lookupSender(db, ACCOUNT, 'pitch@example.net')).toMatchObject({ disposition: 'keep', label: 'sift/cold-outreach', category: 'cold_outreach' });
    expect(() => applyFeedback(db, { accountId: ACCOUNT, sender: 'pitch@example.net', verdict: 'wrong', category: 'nonsense', scope: 'sender' })).toThrow(
      'no category',
    );
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
    suggest('news@example.com', 'archive', { category: 'newsletter' });
    suggest('news@example.com', 'keep');
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'right', suggested: 'archive', scope: 'sender' }, 50);
    expect(db.prepare('SELECT message_id, disposition, category, suggested, suggested_by, status, raw FROM examples ORDER BY message_id').all()).toEqual([
      { message_id: 'm1', disposition: 'archive', category: 'newsletter', suggested: 'archive', suggested_by: 'agent', status: 'pending', raw: null },
      { message_id: 'm2', disposition: 'archive', category: null, suggested: 'keep', suggested_by: 'agent', status: 'pending', raw: null },
    ]);
  });

  it('stores the whole message on the next pass, and keeps the answer when the message is gone', async () => {
    suggest('news@example.com', 'archive');
    suggest('news@example.com', 'archive');
    suggest('news@example.com', 'archive');
    applyFeedback(db, { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'right', suggested: 'archive', scope: 'sender' });

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

  const answer = { accountId: ACCOUNT, sender: 'news@example.com', verdict: 'right', suggested: 'archive', scope: 'sender' };

  it('records an answer sent by the dashboard page and reports what was learned', async () => {
    suggest('news@example.com', 'archive');
    const port = await start();
    expect(await post(port, answer)).toEqual({ status: 200, body: { reviewed: 1, taught: 'From now on, mail from news@example.com is archived.' } });
    expect(db.prepare('SELECT created_at FROM feedback').get()).toEqual({ created_at: 77 });
    const suggestions = (await (await fetch(`http://localhost:${port}/api/suggestions`)).json()) as { waiting: number; accuracy: unknown };
    expect(suggestions).toMatchObject({ waiting: 0, accuracy: { reviewed: 1, right: 1 }, examples: { captured: 0, pending: 1 } });
    expect((suggestions as unknown as { categories: Record<string, { key: string }[]> }).categories[ACCOUNT]?.map((c) => c.key)).toContain('newsletter');
  });

  it("accepts the page when it is opened by one of the machine's own names", async () => {
    suggest('news@example.com', 'archive');
    const port = await start();
    expect((await post(port, answer, { host: `maximus:${port}`, origin: `http://maximus:${port}` })).status).toBe(200);
  });

  it('refuses a write that did not come from the dashboard page', async () => {
    suggest('news@example.com', 'archive');
    const port = await start();
    expect((await post(port, answer, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(port, answer, { origin: '' })).status).toBe(403);
    expect((await post(port, answer, { 'x-sift': '' })).status).toBe(403);
    expect((await post(port, answer, { 'content-type': 'text/plain' })).status).toBe(403);
    expect((await post(port, answer, { host: 'evil.example' })).status).toBe(403);
    expect(db.prepare('SELECT count(*) AS n FROM feedback').get()).toEqual({ n: 0 });
  });

  it('refuses malformed answers and ones about nothing waiting', async () => {
    suggest('news@example.com', 'archive');
    const port = await start();
    expect((await post(port, '{not json')).status).toBe(400);
    expect((await post(port, { ...answer, verdict: 'maybe' })).status).toBe(400);
    expect((await post(port, { ...answer, verdict: 'wrong', correct: 'delete' })).status).toBe(400);
    expect((await post(port, { ...answer, verdict: 'wrong', category: 'DROP TABLE' })).status).toBe(400);
    expect((await post(port, { ...answer, verdict: 'wrong', category: 'nonsense' })).status).toBe(409);
    expect((await post(port, { ...answer, scope: 'message' })).status).toBe(400);
    expect((await post(port, { ...answer, filler: 'x'.repeat(20_000) })).status).toBe(400);
    expect((await post(port, { ...answer, sender: 'nobody@example.com' })).status).toBe(409);
    expect((await fetch(`http://localhost:${port}/api/summary`, { method: 'POST' })).status).toBe(405);
  });
});
