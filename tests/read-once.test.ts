import { beforeEach, describe, expect, it } from 'vitest';
import type { Sql } from '../src/store/sql.ts';
import type { Store } from '../src/store/store.ts';
import { memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { people } from '../src/store/people.ts';
import { setActive } from '../src/store/preferences.ts';
import type { Judge } from '../src/triage/stages/model.ts';
import { type RunOptions, runOnce } from '../src/work/run.ts';
import { ACCOUNT, FakeMailbox, onceGmail, rawMessage, testModel } from './helpers.ts';
import { onePerson, raw, startDashboard } from './fixtures.ts';

const NOW = Date.UTC(2026, 10, 19, 12);
const HOUR = 3_600_000;

let store: Store;
let db: Sql;
let mailbox: FakeMailbox;
let gmail: ReturnType<typeof onceGmail>;

/** Mail from `from`, arrived `hoursAgo`; a reply in `thread` when given one. */
function mail(
  id: string,
  from: string,
  { hoursAgo = 1, thread, labels = ['INBOX', 'UNREAD'] }: { hoursAgo?: number; thread?: string; labels?: string[] } = {},
) {
  return {
    ...rawMessage(id, {
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: ACCOUNT },
        { name: 'Subject', value: `Subject ${id}` },
        ...(thread ? [{ name: 'In-Reply-To', value: `<${thread}@example.org>` }] : []),
      ],
    }),
    threadId: thread ?? `t-${id}`,
    labelIds: labels,
    internalDate: NOW - hoursAgo * HOUR,
  };
}

const options = (judge?: Judge): RunOptions => ({
  ephemeral: memoryEphemeral(),
  connect: () => ({ api: gmail.api, mailbox }),
  ...(judge ? { model: async () => testModel(judge) } : {}),
  log: () => {},
  now: () => NOW,
});

const decided = async () => await raw(db).all('SELECT message_id, label_id FROM decisions ORDER BY id');

beforeEach(async () => {
  ({ store, db } = await onePerson(ACCOUNT));
  mailbox = new FakeMailbox();
  gmail = onceGmail(mailbox);
});

describe('with Inbox off, each message is read from Gmail once', () => {
  it('across a pass, a model call tried on the next pass, and an answer from the dashboard kept as an example', async () => {
    gmail.deliver(mail('kept', 'Ada <ada@example.org>'));
    gmail.deliver(mail('flaky', 'Bo <bo@example.net>', { thread: 'started' }));
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

    expect(gmail.again).toEqual([]);
    expect(gmail.reads.toSorted()).toEqual(['meta:flaky', 'meta:kept', 'thread:started', 'whole:flaky', 'whole:kept']);
  });

  it('learns a correction made in Gmail from history and the record', async () => {
    await setActive(db, true);
    gmail.deliver(mail('news', 'News <news@example.com>'));
    await runOnce(
      db,
      options(async () => ({ label: 'newsletter', reason: 'a newsletter', confidence: 0.95 })),
    );
    expect(mailbox.labels.get('news')).not.toContain('INBOX');

    mailbox.byUser('news', { add: ['INBOX'] });
    await runOnce(db, options());
    expect(await raw(db).all('SELECT via, disposition FROM feedback')).toEqual([{ via: 'gmail', disposition: 'keep' }]);

    expect(gmail.again).toEqual([]);
    expect(gmail.reads).toEqual(['meta:news', 'whole:news']);
  });
});
