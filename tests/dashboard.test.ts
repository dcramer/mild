import { scopeFor } from '../src/dashboard/scope.ts';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Sql } from '../src/store/sql.ts';
import { describe, expect, it } from 'vitest';
import { execute } from '../src/actions/executor.ts';
import { listDecisions, retryDecision } from '../src/dashboard/queries/decisions.ts';
import { listRuleSummaries } from '../src/dashboard/queries/rules.ts';
import { summarize } from '../src/dashboard/queries/summary.ts';
import type { SenderPage } from '../src/dashboard/types.ts';
import type { DashboardOptions } from '../src/dashboard/server.ts';
import { people } from '../src/store/people.ts';
import { addMailbox, recordSync } from '../src/store/accounts.ts';
import { finishAction, insertPendingAction, setActionStatus } from '../src/store/actions.ts';
import { recordDecision, settleDecision } from '../src/store/decisions.ts';
import { finishRun, startRun } from '../src/store/runs.ts';
import { builtAssets, openUserDb, raw, startDashboard, onePerson } from './fixtures.ts';
import type { Store } from '../src/store/store.ts';
import { addRule } from '../src/store/rules.ts';
import { everything, facts } from './helpers.ts';

const ACCOUNT = 'me@example.org';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12);

async function seededStore(): Promise<{ store: Store; db: Sql }> {
  const { store, db } = await onePerson(ACCOUNT);
  await recordSync(
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
  const judged = async (messageId: string, costUsd: number, outcome: 'judged' | 'failed' = 'judged') => {
    const run = await startRun(db, { accountId: ACCOUNT, messageId, model: 'test-model', now: NOW - 2 * DAY });
    await finishRun(db, run, { outcome, usage: { model: 'test-model', inputTokens: 900, outputTokens: 100, costUsd }, now: NOW - 2 * DAY });
    return run;
  };
  await recordDecision(
    db,
    ACCOUNT,
    'a',
    { ...base, disposition: 'archive', stage: 'rules', ruleId: 'r1', labelId: 'newsletter', gmailLabel: 'sift/newsletters' },
    { now: NOW - DAY },
  );
  await recordDecision(db, ACCOUNT, 'b', { ...base, disposition: 'archive', stage: 'sender' }, { now: NOW - DAY });
  await recordDecision(
    db,
    ACCOUNT,
    'c',
    { ...base, disposition: 'review', stage: 'agent', confidence: 0.4 },
    { now: NOW - 2 * DAY, durationMs: 1500, runId: await judged('c', 0.02) },
  );
  // A call that failed costs too, and decided nothing.
  await judged('b', 0.01, 'failed');
  await recordDecision(db, ACCOUNT, 'old', { ...base, disposition: 'keep', stage: 'rules' }, { now: NOW - 40 * DAY });
  return { store, db };
}
const seeded = async () => (await seededStore()).db;

describe('tracking', () => {
  it('stores the subject and triage headers with each message, and never a body', async () => {
    const db = await openUserDb();
    await addMailbox(db, ACCOUNT, '1', 0);
    await recordSync(
      db,
      ACCOUNT,
      [facts({ messageId: 'a', headers: { 'list-id': '<dev.lists.example.com>' }, cc: [{ address: 'c@example.org', domain: 'example.org' }] })],
      '2',
      NOW,
    );
    const row = (await raw(db).get('SELECT * FROM messages'))!;
    expect(row).toMatchObject({
      subject: 'Weekly digest',
      list_id: 'dev.lists.example.com',
      synced_at: NOW,
      label_ids: ['INBOX', 'UNREAD'],
      headers: { 'list-id': '<dev.lists.example.com>' },
      cc_addresses: [{ address: 'c@example.org', domain: 'example.org' }],
    });
    expect(Object.keys(row).some((k) => /body|snippet|content/.test(k))).toBe(false);
  });

  it('keeps every decision for a message, with its cost', async () => {
    const db = await seeded();
    await recordDecision(db, ACCOUNT, 'c', { disposition: 'keep', subscription: 'preserve', stage: 'rules', reason: 'user correction' }, { now: NOW });
    const rows = await raw(db).all(
      `SELECT d.stage, d.disposition, r.model, r.cost_usd, r.input_tokens, d.duration_ms FROM decisions d LEFT JOIN model_runs r ON r.id = d.run_id WHERE d.message_id = 'c' ORDER BY d.id`,
    );
    expect(rows).toEqual([
      { stage: 'agent', disposition: 'review', model: 'test-model', cost_usd: 0.02, input_tokens: 900, duration_ms: 1500 },
      { stage: 'rules', disposition: 'keep', model: null, cost_usd: null, input_tokens: null, duration_ms: null },
    ]);
  });

  it('links an action to the decision it carried out', async () => {
    const db = await seeded();
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
      listFilters: async () => [],
    };
    await execute({ db, mailbox, now: () => NOW }, ACCOUNT, 'a', { type: 'archive' }, 1);
    expect(await raw(db).get('SELECT decision_id, status FROM actions')).toEqual({ decision_id: 1, status: 'done' });
    expect((await summarize(db, await everything(db), 7, NOW)).recent.find((r) => r.id === 1)).toMatchObject({
      actionId: 1,
      actionType: 'archive',
      actionStatus: 'done',
    });
  });

  it('groups decisions by where they got to, and shows the mailbox change rather than an unsubscribe', async () => {
    const db = await seeded();
    const base = { subscription: 'preserve', reason: 'test', stage: 'rules' } as const;
    const done = await recordDecision(db, ACCOUNT, 'a', { ...base, disposition: 'archive' }, { mode: 'act', now: NOW });
    const archived = await insertPendingAction(
      db,
      { accountId: ACCOUNT, messageId: 'a', type: 'archive', payload: { add: [], remove: ['INBOX'] }, originalLabels: ['INBOX'], decisionId: done },
      NOW,
    );
    await finishAction(db, archived, 'done', [], null, NOW);
    const unsubscribed = await insertPendingAction(
      db,
      { accountId: ACCOUNT, messageId: 'a', type: 'unsubscribe', payload: { add: [], remove: [] }, originalLabels: [], decisionId: done },
      NOW,
    );
    await finishAction(db, unsubscribed, 'done', null, null, NOW);
    await settleDecision(db, done, 'done');
    const failed = await recordDecision(db, ACCOUNT, 'b', { ...base, disposition: 'archive' }, { mode: 'act', now: NOW });
    await settleDecision(db, failed, 'failed', 'Gmail answered 503');
    const ids = async (status: string) => (await listDecisions(db, await everything(db), { days: 7, status }, NOW)).rows.map((r) => r.id);

    expect(await ids('suggested')).toEqual([3, 2, 1]);
    expect(await ids('done')).toEqual([done]);
    expect(await ids('trouble')).toEqual([failed]);
    expect(await ids('nonsense')).toEqual([]);
    expect((await listDecisions(db, await everything(db), { days: 7, status: 'done' }, NOW)).rows[0]).toMatchObject({
      actionId: archived,
      actionType: 'archive',
    });

    await setActionStatus(db, archived, 'undone');
    expect(await ids('undone')).toEqual([done]);
    expect(await ids('done')).toEqual([]);
    expect((await listDecisions(db, await everything(db), { days: 7, status: 'trouble' }, NOW)).total).toBe(1);
    // What changed in Gmail, or was tried: not the suggestions, which never touched it.
    expect(await ids('changed')).toEqual([failed, done]);

    // A failed change goes back to waiting; sift's own waits for sift to be on, and only a failure can be retried.
    expect(await retryDecision(db, scopeFor(['someone@example.net'], false), failed)).toEqual({ retried: false, waiting: false });
    expect(await retryDecision(db, await everything(db), failed)).toEqual({ retried: true, waiting: true });
    expect(await raw(db).get('SELECT outcome FROM decisions WHERE id = ?', failed)).toEqual({ outcome: null });
    expect(await retryDecision(db, await everything(db), done)).toEqual({ retried: false, waiting: false });
  });

  it('counts only the window and reports tiers, cost and backlog', async () => {
    const db = await seeded();
    const summary = await summarize(db, await everything(db), 7, NOW);
    expect(summary.totals).toEqual({ messages: 4, decisions: 3, withoutInference: 2, costUsd: 0.03, awaitingTriage: 1, troubledActions: 0 });
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

  it('returns one entry per day, including empty days', async () => {
    const db = await seeded();
    const { daily } = await summarize(db, await everything(db), 7, NOW);
    expect(daily).toHaveLength(7);
    expect(daily.reduce((sum, d) => sum + Object.values(d.counts).reduce((a, b) => a + b, 0), 0)).toBe(3);
    expect(daily.at(-1)?.counts).toEqual({ rules: 0, sender: 0, classifier: 0, agent: 0, fallback: 0 });
  });

  it('says per day what was done in Gmail, what failed, and what the model cost', async () => {
    const db = await seeded();
    const base = { subscription: 'preserve', reason: 'test', stage: 'rules' } as const;
    const archived = await recordDecision(db, ACCOUNT, 'a', { ...base, disposition: 'archive' }, { mode: 'act', now: NOW });
    const change = await insertPendingAction(
      db,
      { accountId: ACCOUNT, messageId: 'a', type: 'archive', payload: { add: [], remove: ['INBOX'] }, originalLabels: ['INBOX'], decisionId: archived },
      NOW,
    );
    await finishAction(db, change, 'done', [], null, NOW);
    await settleDecision(db, archived, 'done');
    await settleDecision(
      db,
      await recordDecision(db, ACCOUNT, 'b', { ...base, disposition: 'spam' }, { mode: 'act', now: NOW }),
      'failed',
      'Gmail answered 503',
    );
    const { daily } = await summarize(db, await everything(db), 7, NOW);
    expect(daily.at(-1)?.changes).toEqual({ archive: 1, spam: 0, keep: 0, failed: 1 });
    // Suggestions changed nothing, so the other days have no changes; the model's cost is on the day it was asked.
    expect(daily.slice(0, -1).every((d) => d.changes.archive + d.changes.spam + d.changes.keep + d.changes.failed === 0)).toBe(true);
    expect(daily.reduce((sum, d) => sum + d.costUsd, 0)).toBeCloseTo(0.03);
  });

  it('lists senders and recent decisions with their message', async () => {
    const db = await seeded();
    const summary = await summarize(db, await everything(db), 7, NOW);
    expect(summary.topSenders[0]).toEqual({ address: 'news@example.com', messages: 3, lastDisposition: 'keep' });
    expect(summary.recent.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(summary.recent[2]).toMatchObject({
      subject: 'Weekly digest',
      fromName: 'Example News',
      stage: 'rules',
      labelId: 'newsletter',
      gmailLabel: 'sift/newsletters',
      actionId: null,
    });
  });

  it('handles an empty database', async () => {
    const empty = await openUserDb();
    const summary = await summarize(empty, await everything(empty), 30, NOW);
    expect(summary.totals.decisions).toBe(0);
    expect(summary.daily).toHaveLength(30);
    expect(summary.recent).toEqual([]);
  });
});

const assets = () =>
  builtAssets({
    'index.html': '<!doctype html><script type="module" src="/assets/app-abc123.js"></script>',
    'assets/app-abc123.js': 'console.log(1)',
    'assets/app-abc123.css': 'body{}',
    'secret.env': 'TOKEN=x',
  });

const get = async <T>(url: string) => (await (await fetch(url)).json()) as T;

describe('dashboard server', () => {
  /** The dashboard's address, over `store` or else a newly seeded one. */
  async function start(options: DashboardOptions = {}, store?: Store) {
    const over = store ?? (await seededStore()).store;
    return (await startDashboard(people(over), { assetsDir: assets(), now: () => NOW, ...options })).base;
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

  it('serves the app manifest and the service worker, which the policy allows from this server only', async () => {
    const dir = assets();
    writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
    writeFileSync(join(dir, 'sw.js'), 'self');
    const base = await start({ assetsDir: dir });
    const csp = (await fetch(base)).headers.get('content-security-policy') ?? '';
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect((await fetch(`${base}/manifest.webmanifest`)).headers.get('content-type')).toBe('application/manifest+json');
    const worker = await fetch(`${base}/sw.js`);
    expect(worker.headers.get('content-type')).toContain('javascript');
    // Never from a cache: a browser must see a new build's worker to replace the old one.
    expect(worker.headers.get('cache-control')).toBe('no-store');
  });

  it('serves the page for the paths it reads itself, and nothing else in place of a missing file', async () => {
    const base = await start();
    const home = await (await fetch(base)).text();
    for (const path of [
      '/rules',
      '/settings/accounts',
      '/system',
      '/privacy',
      '/terms',
      '/decisions?q=digest&message=a',
      '/sender/me%40example.org/news%40example.com',
      '/domain/me%40example.org/example.com',
    ]) {
      const page = await fetch(`${base}${path}`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(await page.text()).toBe(home);
    }
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/assets/missing`)).status).toBe(404);
    expect((await fetch(`${base}/rules.json`)).status).toBe(404);
    // Sign-in is not set up here, so its paths are not the page either.
    expect((await fetch(`${base}/auth/login`, { redirect: 'manual' })).status).toBe(404);
    expect((await fetch(`${base}/api/rules/nope`)).status).toBe(404);
  });

  it('in dev mode serves the page as it is on disk now, and tells it when to reload', async () => {
    const dir = assets();
    const base = await start({ assetsDir: dir, dev: true });

    const page = await fetch(base);
    expect(await page.text()).toContain('<script type="module" src="/dev/reload.js"></script>');
    // Same policy as normal: the reload script is a file of the server's own, not inline.
    expect(page.headers.get('content-security-policy')).not.toContain('unsafe');
    expect(await (await fetch(`${base}/dev/reload.js`)).text()).toContain("EventSource('/dev/events')");
    expect((await fetch(`${base}/assets/app-abc123.js`)).headers.get('cache-control')).toBe('no-store');

    // A file written after the server started is served, and the page is told the build changed.
    const events = await fetch(`${base}/dev/events`);
    const reader = events.body!.getReader();
    const next = async () => new TextDecoder().decode((await reader.read()).value);
    let stream = await next();
    while (!stream.includes('data: ')) stream += await next();
    writeFileSync(join(dir, 'assets', 'later-def456.js'), 'console.log(2)');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head></head><body>rebuilt</body></html>');
    const fs = await import('node:fs');
    fs.utimesSync(join(dir, 'index.html'), new Date(NOW + 60_000), new Date(NOW + 60_000));
    const first = /data: (\S+)/.exec(stream)?.[1];
    let after = '';
    while (!/data: /.test(after)) after += await next();
    expect(/data: (\S+)/.exec(after)?.[1]).not.toBe(first);
    await reader.cancel();
    expect(await (await fetch(base)).text()).toContain('rebuilt');
    expect((await fetch(`${base}/assets/later-def456.js`)).status).toBe(200);
  });

  it('has no dev routes unless asked', async () => {
    const base = await start();
    expect((await fetch(`${base}/dev/reload.js`)).status).toBe(404);
    expect(await (await fetch(base)).text()).not.toContain('/dev/reload.js');
  });

  it('serves only listed asset types and never escapes the asset directory', async () => {
    const base = await start();
    expect((await fetch(`${base}/secret.env`)).status).toBe(404);
    expect((await fetch(`${base}/..%2f..%2fpackage.json`)).status).toBe(404);
    expect((await fetch(`${base}/assets/../../package.json`)).status).toBe(404);
  });

  it('says how to build when the app has not been built, and still serves the API', async () => {
    const base = await start({ assetsDir: join(tmpdir(), 'sift-web-missing') });
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
    const db = await seeded();
    const id = await addRule(db, ACCOUNT, { match: { fromDomain: 'example.com' }, labelId: 'newsletter' }, 'user', NOW);
    await recordDecision(db, ACCOUNT, 'waiting', { disposition: 'archive', subscription: 'preserve', stage: 'rules', ruleId: id, reason: 'r' }, { now: NOW });
    expect(await listRuleSummaries(db, await everything(db))).toEqual([
      {
        id,
        accountId: ACCOUNT,
        match: { fromDomain: 'example.com' },
        except: [],
        labelId: 'newsletter',
        labelName: 'Newsletters',
        override: null,
        disposition: 'archive',
        markRead: false,
        unsubscribe: true,
        kind: 'label',
        whenLabel: null,
        labelGone: false,
        when: null,
        source: 'user',
        hits: 0,
        lastHitAt: NOW,
        filterId: null,
        filter: {
          state: 'none',
          possible: true,
          reason: null,
          differs: ['Mail the filter archives never reaches sift: it is not recorded, counted or unsubscribed from.'],
          checkedAt: null,
        },
        createdAt: NOW,
      },
    ]);
  });

  it('serves a sender and a domain, and gives them a standing with one write', async () => {
    const { store, db } = await seededStore();
    const base = await start({}, store);
    const sender = (await (await fetch(`${base}/api/sender?account=${ACCOUNT}&address=news@example.com`)).json()) as SenderPage;
    expect(sender).toMatchObject({ kind: 'sender', name: 'Example News', profile: { address: 'news@example.com', messages: 4, standing: 'new' } });
    expect(sender.profile.domain).toMatchObject({ name: 'example.com', senders: 1 });
    expect(sender.decisions.every((d) => d.fromAddress === 'news@example.com')).toBe(true);
    expect(sender.decisions.map((d) => d.messageId)).toContain('a');

    const write = (body: object) =>
      fetch(`${base}/api/standing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base, 'x-sift': '1' },
        body: JSON.stringify(body),
      });
    expect((await write({ accountId: ACCOUNT, address: 'news@example.com', standing: 'trusted' })).status).toBe(200);
    // Trust is a rule for exactly them that only says what happens: keep it, whatever it is.
    expect((await listRuleSummaries(db, await everything(db))).filter((r) => r.match['from'] === 'news@example.com')).toMatchObject([
      { kind: 'action', labelId: null, override: 'keep', disposition: 'keep', source: 'user' },
    ]);
    const trusted = (await (await fetch(`${base}/api/sender?account=${ACCOUNT}&address=news@example.com`)).json()) as SenderPage;
    expect(trusted.profile).toMatchObject({ standing: 'trusted', why: 'a rule keeps their mail' });

    expect((await write({ accountId: ACCOUNT, domain: 'example.net', standing: 'blocked' })).status).toBe(200);
    const domain = (await (await fetch(`${base}/api/domain?account=${ACCOUNT}&domain=example.net`)).json()) as SenderPage;
    expect(domain).toMatchObject({ kind: 'domain', profile: { standing: 'blocked' }, senders: [{ address: 'cold@example.net', standing: 'new' }] });

    expect((await write({ accountId: ACCOUNT, address: 'news@example.com', standing: 'none' })).status).toBe(200);
    expect((await listRuleSummaries(db, await everything(db))).filter((r) => r.match['from'] === 'news@example.com')).toEqual([]);

    expect((await write({ accountId: ACCOUNT, address: 'news@example.com', domain: 'example.com', standing: 'trusted' })).status).toBe(400);
    expect((await write({ accountId: ACCOUNT, address: 'not an address', standing: 'trusted' })).status).toBe(400);
    expect((await fetch(`${base}/api/domain?account=${ACCOUNT}&domain=gmail.com`)).status).toBe(404);
  });

  it('rejects bad input, other methods and unknown paths', async () => {
    const base = await start();
    expect((await fetch(`${base}/api/summary?days=5000`)).status).toBe(400);
    expect((await fetch(`${base}/api/summary`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it('answers only to localhost and to hosts the user configured', async () => {
    const { request } = await import('node:http');
    const statusFor = (base: string, host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(`${base}/api/summary`, { headers: { host } }, (res) => resolve(res.statusCode ?? 0));
        req.on('error', reject);
        req.end();
      });

    const { store } = await seededStore();
    const base = await start({}, store);
    expect(await statusFor(base, 'evil.example')).toBe(403);
    expect(await statusFor(base, '100.64.0.7:8787')).toBe(403);

    const configured = await start({ allowedHosts: ['Box.example.ts.net', '100.64.0.7'] }, store);
    expect(await statusFor(configured, 'box.example.ts.net:8787')).toBe(200);
    expect(await statusFor(configured, '100.64.0.7')).toBe(200);
    expect(await statusFor(configured, 'localhost:1')).toBe(200);
    expect(await statusFor(configured, 'evil.example')).toBe(403);
  });
});
