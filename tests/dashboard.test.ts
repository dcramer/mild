import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { execute } from '../src/actions/executor.ts';
import { listRuleSummaries, summarize } from '../src/dashboard/queries.ts';
import { createDashboardServer } from '../src/dashboard/server.ts';
import { connectAccount, recordSync } from '../src/store/accounts.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { openDb, schemaVersion } from '../src/store/db.ts';
import { addRule } from '../src/store/rules.ts';
import { facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12);

function seeded(): DatabaseSync {
  const db = openDb(':memory:');
  connectAccount(db, ACCOUNT, '1', 0);
  recordSync(
    db,
    ACCOUNT,
    [
      facts({
        messageId: 'a',
        subject: 'Weekly digest',
        receivedAt: NOW - DAY,
        from: { address: 'news@example.com', domain: 'example.com', name: 'Example News' },
      }),
      facts({ messageId: 'b', subject: 'Second digest', receivedAt: NOW - DAY }),
      facts({
        messageId: 'c',
        subject: '<img src=x onerror=alert(1)>',
        receivedAt: NOW - 2 * DAY,
        from: { address: 'cold@example.net', domain: 'example.net' },
      }),
      facts({ messageId: 'old', receivedAt: NOW - 40 * DAY }),
      facts({ messageId: 'waiting', receivedAt: NOW }),
    ],
    '2',
    NOW,
  );
  const base = { subscription: 'preserve', reason: 'test' } as const;
  recordDecision(db, ACCOUNT, 'a', { ...base, disposition: 'archive', stage: 'rules', ruleId: 'r1', label: 'sift/news' }, { now: NOW - DAY });
  recordDecision(db, ACCOUNT, 'b', { ...base, disposition: 'archive', stage: 'sender' }, { now: NOW - DAY });
  recordDecision(
    db,
    ACCOUNT,
    'c',
    { ...base, disposition: 'review', stage: 'agent', confidence: 0.4, usage: { model: 'test-model', inputTokens: 900, outputTokens: 100, costUsd: 0.02 } },
    { now: NOW - 2 * DAY, durationMs: 1500 },
  );
  recordDecision(db, ACCOUNT, 'old', { ...base, disposition: 'keep', stage: 'rules' }, { now: NOW - 40 * DAY });
  return db;
}

describe('tracking', () => {
  it('stores the subject and triage headers with each message, and never a body', () => {
    const db = openDb(':memory:');
    connectAccount(db, ACCOUNT, '1', 0);
    recordSync(
      db,
      ACCOUNT,
      [facts({ messageId: 'a', headers: { 'list-id': '<dev.lists.example.com>' }, cc: [{ address: 'c@example.org', domain: 'example.org' }] })],
      '2',
      NOW,
    );
    const row = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
    expect(row).toMatchObject({ subject: 'Weekly digest', list_id: 'dev.lists.example.com', synced_at: NOW, labels_json: '["INBOX","UNREAD"]' });
    expect(JSON.parse(row['headers_json'] as string)).toEqual({ 'list-id': '<dev.lists.example.com>' });
    expect(JSON.parse(row['cc_json'] as string)).toEqual([{ address: 'c@example.org', domain: 'example.org' }]);
    expect(Object.keys(row).some((k) => /body|snippet|content/.test(k))).toBe(false);
  });

  it('keeps every decision for a message, with its cost', () => {
    const db = seeded();
    recordDecision(db, ACCOUNT, 'c', { disposition: 'keep', subscription: 'preserve', stage: 'rules', reason: 'user correction' }, { now: NOW });
    const rows = db.prepare(`SELECT stage, disposition, model, cost_usd, input_tokens, duration_ms FROM decisions WHERE message_id = 'c' ORDER BY id`).all();
    expect(rows).toEqual([
      { stage: 'agent', disposition: 'review', model: 'test-model', cost_usd: 0.02, input_tokens: 900, duration_ms: 1500 },
      { stage: 'rules', disposition: 'keep', model: null, cost_usd: 0, input_tokens: 0, duration_ms: null },
    ]);
  });

  it('links an action to the decision it carried out', async () => {
    const db = seeded();
    const labels = ['INBOX'];
    const mailbox = {
      getLabelIds: async () => [...labels],
      modifyLabels: async (_id: string, change: { add: string[]; remove: string[] }) => {
        labels.splice(0, labels.length, ...labels.filter((l) => !change.remove.includes(l)), ...change.add);
      },
      ensureLabel: async (name: string) => `L:${name}`,
      hasSentTo: async () => false,
      createFilter: async () => 'f',
      deleteFilter: async () => {},
    };
    await execute({ db, mailbox, now: () => NOW }, ACCOUNT, 'a', { type: 'archive' }, 1);
    expect(db.prepare('SELECT decision_id, status FROM actions').get()).toEqual({ decision_id: 1, status: 'done' });
    expect(summarize(db, 7, NOW).recent.find((r) => r.id === 1)).toMatchObject({ actionId: 1, actionType: 'archive', actionStatus: 'done' });
  });

  it('upgrades a version 1 database in place, keeping its messages', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sift-test-')), 'sift.db');
    const v1 = new DatabaseSync(path);
    v1.exec(readFileSync(new URL('../src/store/migrations/001_init.sql', import.meta.url), 'utf8'));
    v1.exec('PRAGMA user_version = 1');
    v1.exec(`INSERT INTO accounts (id, email, created_at) VALUES ('${ACCOUNT}', '${ACCOUNT}', 0)`);
    v1.exec(
      `INSERT INTO messages (account_id, id, thread_id, from_address, from_domain, received_at) VALUES ('${ACCOUNT}', 'm', 't', 'a@example.com', 'example.com', 5)`,
    );
    v1.close();

    const db = openDb(path);
    expect(schemaVersion(db)).toBeGreaterThan(1);
    expect(db.prepare('SELECT id, subject, headers_json, synced_at FROM messages').get()).toEqual({
      id: 'm',
      subject: '',
      headers_json: '{}',
      synced_at: null,
    });
    recordDecision(db, ACCOUNT, 'm', { disposition: 'keep', subscription: 'preserve', stage: 'rules', reason: 'r' });
    expect(db.prepare('SELECT count(*) AS n FROM decisions').get()).toEqual({ n: 1 });
    db.close();
  });
});

describe('summarize', () => {
  it('counts only the window and reports tiers, cost and backlog', () => {
    const summary = summarize(seeded(), 7, NOW);
    expect(summary.totals).toEqual({ messages: 4, decisions: 3, withoutInference: 2, costUsd: 0.02, awaitingTriage: 1, openQuestions: 0, troubledActions: 0 });
    expect(summary.byStage.map((s) => [s.stage, s.decisions])).toEqual([
      ['rules', 1],
      ['sender', 1],
      ['classifier', 0],
      ['agent', 1],
      ['fallback', 0],
    ]);
    expect(summary.byStage.find((s) => s.stage === 'agent')).toMatchObject({ costUsd: 0.02, tokens: 1000 });
    expect(summary.byDisposition).toEqual([
      { disposition: 'archive', decisions: 2 },
      { disposition: 'review', decisions: 1 },
    ]);
    expect(summary.accounts).toEqual([{ email: ACCOUNT, lastSyncedAt: NOW }]);
  });

  it('returns one entry per day, including empty days', () => {
    const { daily } = summarize(seeded(), 7, NOW);
    expect(daily).toHaveLength(7);
    expect(daily.reduce((sum, d) => sum + Object.values(d.counts).reduce((a, b) => a + b, 0), 0)).toBe(3);
    expect(daily.at(-1)?.counts).toEqual({ rules: 0, sender: 0, classifier: 0, agent: 0, fallback: 0 });
  });

  it('lists senders and recent decisions with their message', () => {
    const summary = summarize(seeded(), 7, NOW);
    expect(summary.topSenders[0]).toEqual({ address: 'news@example.com', messages: 3, lastDisposition: 'keep' });
    expect(summary.recent.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(summary.recent[2]).toMatchObject({ subject: 'Weekly digest', fromName: 'Example News', stage: 'rules', label: 'sift/news', actionId: null });
  });

  it('handles an empty database', () => {
    const summary = summarize(openDb(':memory:'), 30, NOW);
    expect(summary.totals.decisions).toBe(0);
    expect(summary.daily).toHaveLength(30);
    expect(summary.recent).toEqual([]);
  });
});

/** A stand-in for the built web app. */
function builtAssets(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sift-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><script type="module" src="/assets/app-abc123.js"></script>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'app-abc123.css'), 'body{}');
  writeFileSync(join(dir, 'secret.env'), 'TOKEN=x');
  return dir;
}

const get = async <T>(url: string) => (await (await fetch(url)).json()) as T;

describe('dashboard server', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  async function start(assetsDir: string = builtAssets()) {
    const server = createDashboardServer(seeded(), { assetsDir, now: () => NOW });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => server.close();
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('serves the built app with a strict content security policy', async () => {
    const base = await start();
    const page = await fetch(base);
    expect(page.status).toBe(200);
    const csp = page.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain('unsafe');
    expect(page.headers.get('cache-control')).toBe('no-store');

    const script = await fetch(`${base}/assets/app-abc123.js`);
    expect(script.headers.get('content-type')).toContain('javascript');
    expect(script.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/assets/app-abc123.css`)).status).toBe(200);
  });

  it('serves only listed asset types and never escapes the asset directory', async () => {
    const base = await start();
    expect((await fetch(`${base}/secret.env`)).status).toBe(404);
    expect((await fetch(`${base}/..%2f..%2fpackage.json`)).status).toBe(404);
    expect((await fetch(`${base}/assets/../../package.json`)).status).toBe(404);
  });

  it('says how to build when the app has not been built, and still serves the API', async () => {
    const base = await start(join(tmpdir(), 'sift-web-missing'));
    const page = await fetch(base);
    expect(page.status).toBe(503);
    expect(await page.text()).toContain('pnpm build:web');
    expect((await fetch(`${base}/api/summary`)).status).toBe(200);
  });

  it('serves the summary', async () => {
    const summary = await get<{ days: number; recent: unknown[] }>(`${await start()}/api/summary?days=90`);
    expect(summary.days).toBe(90);
    expect(summary.recent).toHaveLength(4);
  });

  it('lists decisions with filters, search and paging', async () => {
    const base = await start();
    type Page = { total: number; rows: { id: number; messageId: string; subject: string }[] };
    expect((await get<Page>(`${base}/api/decisions?days=7`)).rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect((await get<Page>(`${base}/api/decisions?days=7&stage=agent`)).rows.map((r) => r.messageId)).toEqual(['c']);
    expect((await get<Page>(`${base}/api/decisions?days=7&disposition=archive`)).total).toBe(2);
    expect((await get<Page>(`${base}/api/decisions?days=7&q=EXAMPLE+news`)).rows.map((r) => r.messageId)).toEqual(['a']);
    expect((await get<Page>(`${base}/api/decisions?days=7&q=${encodeURIComponent('%')}`)).total).toBe(0);
    expect((await get<Page>(`${base}/api/decisions?days=7&stage=${encodeURIComponent("x' OR 1=1 --")}`)).total).toBe(0);

    const paged = await get<Page>(`${base}/api/decisions?days=7&limit=1&offset=1`);
    expect(paged.total).toBe(3);
    expect(paged.rows.map((r) => r.id)).toEqual([2]);
  });

  it('returns one message with its decisions and actions', async () => {
    const base = await start();
    const detail = await get<{ subject: string; decisions: { stage: string; inputTokens: number; durationMs: number }[]; actions: unknown[] }>(
      `${base}/api/message?account=${encodeURIComponent(ACCOUNT)}&id=c`,
    );
    expect(detail.subject).toBe('<img src=x onerror=alert(1)>');
    expect(detail.decisions).toMatchObject([{ stage: 'agent', inputTokens: 900, durationMs: 1500 }]);
    expect(detail.actions).toEqual([]);
    expect((await fetch(`${base}/api/message?account=${encodeURIComponent(ACCOUNT)}&id=nope`)).status).toBe(404);
  });

  it('lists rules with their hits', async () => {
    const db = seeded();
    const id = addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, disposition: 'archive', label: 'sift/news' }, 'user', NOW);
    recordDecision(db, ACCOUNT, 'waiting', { disposition: 'archive', subscription: 'preserve', stage: 'rules', ruleId: id, reason: 'r' }, { now: NOW });
    expect(listRuleSummaries(db)).toEqual([
      {
        id,
        accountId: ACCOUNT,
        match: { fromDomain: 'example.com' },
        except: [],
        disposition: 'archive',
        label: 'sift/news',
        source: 'user',
        hits: 0,
        lastHitAt: NOW,
        filterId: null,
        createdAt: NOW,
      },
    ]);
  });

  it('rejects bad input, other methods and unknown paths', async () => {
    const base = await start();
    expect((await fetch(`${base}/api/summary?days=5000`)).status).toBe(400);
    expect((await fetch(`${base}/api/summary`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it('answers only requests addressed to localhost', async () => {
    const base = await start();
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/api/summary`, { headers: { host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
