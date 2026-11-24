import { beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/store/sql.ts';
import type { Store } from '../src/store/store.ts';
import { memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { people } from '../src/store/people.ts';
import { listAccounts } from '../src/store/accounts.ts';
import { recordSync } from '../src/store/messages.ts';
import { credentials } from '../src/store/credentials.ts';
import { setActive, setMail } from '../src/store/preferences.ts';
import type { Judge } from '../src/triage/stages/model.ts';
import { runOnce } from '../src/work/run.ts';
import { copyMail } from '../src/work/copy.ts';
import { ruleInbox } from '../src/work/apply.ts';
import { readingOnce } from '../src/work/bodies.ts';
import { continueInboxRun, continueRuleRun } from '../src/work/inbox-runs.ts';
import { goingInboxRuns, startInboxRuns } from '../src/store/inbox-runs.ts';
import { addRule } from '../src/store/rules.ts';
import { ACCOUNT, tempDir, testModel, HOUR, runOptions } from './helpers.ts';
import { connectGmail, fakeGoogle, onePerson, raw, startDashboard } from './fixtures.ts';
import { type FakeGmail, SECRETS } from './google.ts';
import { buildControls } from '../src/sift/controls.ts';
import { installClient } from '../src/gmail/auth.ts';
import { loadConfig } from '../src/config.ts';

const NOW = Date.UTC(2026, 10, 19, 12);

const fake = fakeGoogle();

let store: Store;
let db: Sql;
let gmail: ReturnType<typeof connectGmail>;

/**
 * Each read of a message or thread, in order: `meta:<id>` (20 units), `whole:<id>` (60), `thread:<id>`. Reads of a
 * message's labels alone (`minimal`) are left out: they are the re-reads around a change that the executor must make.
 */
const reads = (box: FakeGmail) =>
  box.requests.flatMap((r) => {
    if (r.method === 'users.threads.get') return [`thread:${r.id}`];
    if (r.method !== 'users.messages.get' || r.format === 'minimal') return [];
    return [`${r.format === 'metadata' ? 'meta' : 'whole'}:${r.id}`];
  });

/** Each read of a message that was not the first at its weight: its metadata may be read once and its whole once, and nothing again. */
const again = (box: FakeGmail) => reads(box).filter((read, i, all) => !read.startsWith('thread:') && all.indexOf(read) < i);

/** Mail from `from`, arrived `hoursAgo`; a reply in `thread` when given one. */
function mail(
  id: string,
  from: string,
  { hoursAgo = 1, thread, labels = ['INBOX', 'UNREAD'] }: { hoursAgo?: number; thread?: string; labels?: string[] } = {},
) {
  return {
    id,
    threadId: thread ?? `t-${id}`,
    from,
    to: ACCOUNT,
    subject: `Subject ${id}`,
    labelIds: labels,
    at: NOW - hoursAgo * HOUR,
    ...(thread ? { headers: { 'In-Reply-To': `<${thread}@example.org>` } } : {}),
  };
}

const options = (judge?: Judge) => runOptions({ connect: () => gmail, ...(judge ? { model: async () => testModel(judge) } : {}), now: () => NOW });

const decided = async () => await raw(db).all('SELECT message_id, label_id FROM decisions ORDER BY id');

beforeEach(async () => {
  ({ store, db } = await onePerson(ACCOUNT));
  gmail = connectGmail(fake.google);
  gmail.gmail.now = () => NOW;
  await recordSync(db, ACCOUNT, [], gmail.gmail.cursor());
});

describe('with Inbox off, each message is read from Gmail once', () => {
  it('across a pass, a model call tried on the next pass, and an answer from the dashboard kept as an example', async () => {
    gmail.gmail.deliver(mail('kept', 'Ada <ada@example.org>'));
    gmail.gmail.deliver(mail('flaky', 'Bo <bo@example.net>', { thread: 'started' }));
    let failing = true;
    const judge: Judge = async ({ evidence }) =>
      evidence.facts.messageId === 'flaky' && failing
        ? { failed: 'the model did not return a usable verdict', unusable: true }
        : { label: 'personal', reason: 'from a person', confidence: 0.95 };

    await runOnce(db, options(judge));
    expect(await decided()).toEqual([{ message_id: 'kept', label_id: 'personal' }]);
    failing = false;
    await runOnce(db, options(judge));
    expect(await decided()).toEqual([
      { message_id: 'kept', label_id: 'personal' },
      { message_id: 'flaky', label_id: 'personal' },
    ]);

    const { call } = await startDashboard(people(store));
    const answered = await call('POST', '/api/feedback', { accountId: ACCOUNT, sender: 'ada@example.org', label: 'request', messageId: 'kept' });
    expect(answered.status).toBe(200);
    await runOnce(db, options(judge));
    expect(await raw(db).get(`SELECT status, body_text FROM examples WHERE message_id = 'kept'`)).toEqual({
      status: 'captured',
      body_text: 'sift-plain:Text of kept.',
    });

    expect(again(gmail.gmail)).toEqual([]);
    expect(reads(gmail.gmail).toSorted()).toEqual(['meta:flaky', 'meta:kept', 'thread:started', 'whole:flaky', 'whole:kept']);
  });

  it('learns a correction made in Gmail from history and the record', async () => {
    await setActive(db, true);
    gmail.gmail.deliver(mail('news', 'News <news@example.com>'));
    await runOnce(
      db,
      options(async () => ({ label: 'newsletter', reason: 'a newsletter', confidence: 0.95 })),
    );
    expect(gmail.gmail.labelsOf('news')).not.toContain('INBOX');

    gmail.gmail.change('news', { add: ['INBOX'] });
    await runOnce(db, options());
    expect(await raw(db).all('SELECT via, disposition FROM feedback')).toEqual([{ via: 'gmail', disposition: 'keep' }]);

    expect(again(gmail.gmail)).toEqual([]);
    expect(reads(gmail.gmail)).toEqual(['meta:news', 'whole:news']);
  });
});

describe('applying a rule to mail already there', () => {
  it('reads from Gmail only mail Mild never recorded, once, however often it is looked at', async () => {
    gmail.gmail.deliver(mail('seen', 'News <news@example.com>'));
    await runOnce(db, options());
    for (const [id, from, hoursAgo] of [
      ['old1', 'News <news@example.com>', 48],
      ['other', 'Bo <bo@example.net>', 49],
      ['old2', 'News <news@example.com>', 50],
    ] as const)
      gmail.gmail.deliver(mail(id, from, { hoursAgo }), { quietly: true });
    const rule = await addRule(db, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');

    for (let look = 0; look < 2; look++) expect(await ruleInbox(db, gmail.api, ACCOUNT, rule, NOW)).toMatchObject({ messages: 3, reading: 0, exact: true });
    await startInboxRuns(db, [ACCOUNT], { acts: false, most: 10_000, now: NOW, ruleId: rule });
    const [run] = await goingInboxRuns(db);
    await continueRuleRun({ db, api: gmail.api, mailbox: gmail.mailbox, now: () => NOW }, run!.id);
    expect(await raw(db).all('SELECT message_id, by_user FROM decisions ORDER BY message_id')).toEqual([
      { message_id: 'old1', by_user: true },
      { message_id: 'old2', by_user: true },
      { message_id: 'seen', by_user: true },
    ]);

    expect(again(gmail.gmail)).toEqual([]);
    expect(reads(gmail.gmail).toSorted()).toEqual(['meta:old1', 'meta:old2', 'meta:seen']);
  });
});

describe('with Inbox on, a message is read once, whole', () => {
  it('as it arrives, for the model and for Inbox alike, and its conversation is shown from the record', async () => {
    gmail.gmail.deliver(mail('asked', 'Me <me@example.org>', { hoursAgo: 30, labels: ['SENT'] }));
    gmail.gmail.deliver(mail('answer', 'Ada <ada@example.org>', { hoursAgo: 20, thread: 't-asked' }), { quietly: true });
    await setMail(db, true, { now: NOW, window: 'year' });
    expect(await copyMail({ db, api: gmail.api, now: () => NOW }, ACCOUNT)).toBe(2);

    gmail.gmail.deliver(mail('again', 'Ada <ada@example.org>', { thread: 't-asked' }));
    await runOnce(
      db,
      options(async () => ({ label: 'personal', reason: 'from a person', confidence: 0.95 })),
    );
    expect(await decided()).toEqual([{ message_id: 'again', label_id: 'personal' }]);
    expect(await raw(db).get(`SELECT facts->>'earlierInThread' AS earlier, facts->>'ownerInThread' AS owner FROM messages WHERE id = 'again'`)).toEqual({
      earlier: '2',
      owner: 'true',
    });
    const asked = gmail.gmail.requests.length;

    const { call } = await startDashboard(people(store));
    const shown = await call('GET', '/api/mail/thread?thread=t-asked');
    expect(shown.status).toBe(200);
    expect((shown.body as { messages: { messageId: string }[] }).messages.map((m) => m.messageId)).toEqual(['asked', 'answer', 'again']);
    expect((await call('GET', '/api/message?id=again')).body).toMatchObject({ body: 'Text of again.' });

    expect(gmail.gmail.requests.length).toBe(asked);
    expect(again(gmail.gmail)).toEqual([]);
    expect(reads(gmail.gmail)).toEqual(['whole:answer', 'whole:asked', 'whole:again']);
  });
});

describe('going through the inbox with Inbox on', () => {
  it('lists and counts it from the copy, and reads nothing from Gmail', async () => {
    gmail.gmail.deliver(mail('newer', 'Ada <ada@example.org>', { hoursAgo: 20 }), { quietly: true });
    gmail.gmail.deliver(mail('older', 'Bo <bo@example.net>', { hoursAgo: 30 }), { quietly: true });
    gmail.gmail.deliver(mail('archived', 'Cy <cy@example.net>', { hoursAgo: 40, labels: [] }), { quietly: true });
    await setMail(db, true, { now: NOW, window: 'year' });
    expect(await copyMail({ db, api: gmail.api, now: () => NOW }, ACCOUNT)).toBe(3);
    const config = loadConfig({ MILD_HOME: tempDir() });
    installClient(config, JSON.stringify({ web: { client_id: SECRETS.clientId, client_secret: SECRETS.clientSecret } }));
    await (await credentials(db, 'gmail')).write(ACCOUNT, fake.google.grant(ACCOUNT));
    const controls = await buildControls(config, { ephemeral: memoryEphemeral(), deviceId: 'device', kick: async () => {} });
    const before = gmail.gmail.requests.length;

    expect(await controls.inboxEstimate(db, [ACCOUNT], 'inbox')).toMatchObject({ messages: 2 });
    await startInboxRuns(db, [ACCOUNT], { acts: false, most: 10_000, now: NOW });
    const [run] = await goingInboxRuns(db);
    const api = { ...gmail.api, ...readingOnce(db, ACCOUNT, gmail.api, () => NOW) };
    await continueInboxRun(
      {
        db,
        api,
        mailbox: null,
        answers: gmail.mailbox,
        sources: { api, mailbox: gmail.mailbox },
        model: testModel(async () => ({ label: 'personal', reason: 'from a person', confidence: 0.95 })),
        now: () => NOW,
      },
      (await listAccounts(db))[0]!,
      run!.id,
    );
    expect(await raw(db).all(`SELECT messages, finished_at IS NOT NULL AS finished FROM inbox_runs`)).toEqual([
      { messages: ['newer', 'older'], finished: true },
    ]);
    // Decided side by side, so in whichever order they finish.
    expect(await decided()).toHaveLength(2);
    expect(await decided()).toEqual(
      expect.arrayContaining([
        { message_id: 'newer', label_id: 'personal' },
        { message_id: 'older', label_id: 'personal' },
      ]),
    );
    // Whether the person has written to each sender, asked once a sender and remembered, is all it asks.
    expect(gmail.gmail.requests.slice(before)).toHaveLength(2);
    expect(gmail.gmail.requests.slice(before)).toEqual(
      expect.arrayContaining([
        { method: 'users.messages.list', q: 'in:sent to:ada@example.org' },
        { method: 'users.messages.list', q: 'in:sent to:bo@example.net' },
      ]),
    );
  });
});

describe('counts only Gmail knows', () => {
  it('are asked of it once in five minutes, however often a page opens on them', async () => {
    gmail.gmail.deliver(mail('news', 'News <news@example.com>'));
    const rule = await addRule(db, { match: { from: ['news@example.com'] }, labelId: 'newsletter' }, 'user');
    const config = loadConfig({ MILD_HOME: tempDir() });
    installClient(config, JSON.stringify({ web: { client_id: SECRETS.clientId, client_secret: SECRETS.clientSecret } }));
    await (await credentials(db, 'gmail')).write(ACCOUNT, fake.google.grant(ACCOUNT));
    const controls = await buildControls(config, { ephemeral: memoryEphemeral(), deviceId: 'device', kick: async () => {} });
    const before = gmail.gmail.requests.length;
    for (let look = 0; look < 2; look++) {
      expect(await controls.inboxEstimate(db, [ACCOUNT], 'inbox')).toMatchObject({ messages: 1 });
      expect(await controls.mailReach(db, [ACCOUNT])).toMatchObject({ all: { messages: 1 } });
      expect(await controls.ruleInbox(db, rule)).toMatchObject({ messages: 1 });
    }
    expect(gmail.gmail.requests.slice(before).map((r) => (r.method === 'users.messages.get' ? `${r.method}:${r.format}:${r.id}` : r.method))).toEqual([
      'users.labels.get',
      'users.messages.list',
      'users.messages.list',
      'users.getProfile',
      'users.messages.list',
      'users.messages.get:metadata:news',
    ]);
    expect(again(gmail.gmail)).toEqual([]);
  });
});
