#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * Verification scaffolding: fills an empty sift home with synthetic mail and prints a session cookie for it.
 *
 *   node .claude/skills/verify-sift/scripts/seed.ts <home>
 *
 * The mail goes through the real daemon pass (`runEveryone`, with sift off), so decisions, labels, suggestion
 * bodies and proposals are what sift itself would record. Only Gmail is faked, at the `GmailApi` and
 * `Mailbox` ports. Prints one line: the `sift_session` cookie value for the connected account.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../../../../src/config.ts';
import { runEveryone } from '../../../../src/daemon/run.ts';
import { memoryEphemeral } from '../../../../src/ephemeral/ephemeral.ts';
import { applyFeedback, pendingSuggestions } from '../../../../src/learn/feedback.ts';
import type { GmailApi, RawMessage } from '../../../../src/gmail/api.ts';
import { saveApiKey } from '../../../../src/model/models.ts';
import { credentials } from '../../../../src/store/credentials.ts';
import { writeSecret } from '../../../../src/secrets.ts';
import { connectAccount } from '../../../../src/store/accounts.ts';
import { setModel } from '../../../../src/store/preferences.ts';
import { listProposals } from '../../../../src/store/proposals.ts';
import { openStore } from '../../../../src/store/store.ts';
import { addRule } from '../../../../src/store/rules.ts';
import type { JudgeInput } from '../../../../src/triage/stages/model.ts';
import { FakeMailbox } from '../../../../tests/helpers.ts';

const ACCOUNT = 'me@example.org';
const WORK = 'me@work.example.org';
const OTHER = 'bravo@example.net';

const home = process.argv[2];
if (!home) throw new Error('usage: seed.ts <home>');
process.env['SIFT_HOME'] = resolve(home);
const config = loadConfig();
if (existsSync(config.databaseDir)) throw new Error(`${config.databaseDir} already exists. Seed an empty home.`);

const HOUR = 3_600_000;
const now = Date.now();
let n = 0;
const mail = (from: string, subject: string, body: string, extra: { name: string; value: string }[] = [], labelIds: string[] = []) => ({
  raw: {
    id: `m${++n}`,
    threadId: `t${n}`,
    labelIds: ['INBOX', 'UNREAD', ...labelIds],
    internalDate: now - n * HOUR,
    headers: [
      { name: 'From', value: from },
      { name: 'To', value: `Me <${ACCOUNT}>` },
      { name: 'Subject', value: subject },
      { name: 'Authentication-Results', value: `mx.google.com; dmarc=pass header.from=${from.replace(/.*@|>.*/g, '')}` },
      ...extra,
    ],
  } satisfies RawMessage,
  body,
});
const list = (id: string) => [
  { name: 'List-Id', value: `<${id}>` },
  { name: 'List-Unsubscribe', value: `<https://${id}/unsubscribe>` },
  { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
];

const inbox = [
  mail('Weekly Digest <digest@news.example.com>', 'This week in widgets', 'Five stories about widgets.', list('news.example.com')),
  mail('Weekly Digest <digest@news.example.com>', 'Widgets, part two', 'More stories about widgets.', list('news.example.com')),
  mail('Shop <orders@shop.example.com>', 'Your order has shipped', 'Order 1042 is on its way.'),
  mail(
    'Deals <deals@promo.example.com>',
    '48 hours only: 30% off',
    'Everything must go.',
    [...list('promo.example.com'), { name: 'X-Mailer', value: 'Mailchimp Mailer' }, { name: 'Reply-To', value: 'Promo Team <team@promo.example.com>' }],
    ['CATEGORY_PROMOTIONS'],
  ),
  mail('CI <builds@ci.example.org>', 'Build failed on main', 'The build failed at step 3.'),
  mail('Ada Lovelace <ada@example.org>', 'Lunch on Thursday?', 'Are you free for lunch on Thursday?', [{ name: 'In-Reply-To', value: '<lunch@example.org>' }]),
  mail('Grace Hopper <grace@example.net>', 'Notes from the review', 'Attached are my notes.'),
  // The one the stand-in model places, as Marketing.
  mail('Store <sale@store.example.com>', 'Winter sale starts now', 'Up to half off.', list('store.example.com'), ['CATEGORY_PROMOTIONS']),
  // The stand-in model fails on these every time, so after three passes they are out of the queue and not judged.
  mail('Ops <alerts@ops.example.com>', 'Disk 91% full on db-2', 'Free space is running low.'),
  mail('Ops <alerts@ops.example.com>', 'Replica lag on db-3', 'The replica is 40 seconds behind.'),
  // Answered below as Receipts, three alike, so sift proposes a rule for the sender.
  mail('Utility <billing@utility.example.net>', 'Your March bill', 'Your bill is ready.'),
  mail('Utility <billing@utility.example.net>', 'Your April bill', 'Your bill is ready.'),
  mail('Utility <billing@utility.example.net>', 'Your May bill', 'Your bill is ready.'),
];

const store = await openStore(config);
const user = await connectAccount(store, ACCOUNT, '1', now - 24 * HOUR);
const db = await store.user(user);
// One of each kind of rule: a label, an action, and an action for mail that turns out to be a label.
await addRule(db, ACCOUNT, { match: { fromDomain: 'news.example.com' }, labelId: 'newsletter' }, 'user');
await addRule(db, ACCOUNT, { match: { from: 'orders@shop.example.com' }, labelId: 'transactional' }, 'user');
await addRule(db, ACCOUNT, { match: { fromDomain: 'ci.example.org' }, disposition: 'archive' }, 'user');

const mailbox = new FakeMailbox();
for (const { raw } of inbox) mailbox.labels.set(raw.id, [...raw.labelIds]);
let cursor = 1;
const find = (id: string) => inbox.find((m) => m.raw.id === id);
const api: GmailApi = {
  getProfile: async () => ({ emailAddress: ACCOUNT, historyId: String(cursor) }),
  listHistory: async () => ({ additions: cursor++ === 1 ? inbox.map((m) => ({ id: m.raw.id, labelIds: m.raw.labelIds })) : [], historyId: String(cursor) }),
  searchInbox: async () => ({ ids: [] }),
  getMetadata: async (id) => find(id)?.raw ?? null,
  getLabelIds: async (id) => mailbox.labels.get(id) ?? null,
  listLabels: async () => [],
  getBodyText: async (id) => find(id)?.body ?? null,
  // What a model's read of the whole message adds: Grace's notes come with a file, and the Deals mail is tracked.
  getContent: async (id) => {
    const m = find(id);
    if (!m) return null;
    const html = id === 'm4' ? { trackingPixel: true, trackedLinks: true, linkHosts: 2, linksOffDomain: true } : {};
    return { text: m.body, facts: { hasAttachments: id === 'm7', ...html } };
  },
  getThread: async () => null,
  listSendAs: async () => [ACCOUNT],
};

// A stand-in model that calls no provider. It is sure the Store's sale is Marketing, answers unusably about
// the Ops alerts every time (a provider error would be taken for an outage and not count), and can place nothing else, so what no rule covers becomes a question ("Which label?"): with
// no model at all it would wait, undecided, and never be asked about.
const standIn = async () => ({
  model: 'synthetic/stand-in',
  judge: async ({ evidence }: JudgeInput) =>
    evidence.facts.from.address === 'sale@store.example.com'
      ? { label: 'marketing', reason: 'synthetic: a sale sent to a list', confidence: 0.95 }
      : evidence.facts.from.address === 'alerts@ops.example.com'
        ? { failed: 'synthetic: the model did not return a usable verdict', unusable: true as const }
        : { label: 'unsure', reason: 'synthetic: cannot tell', confidence: 0.3 },
});
// Three passes, so the Ops alerts have used up their tries.
const ephemeral = memoryEphemeral();
for (let pass = 0; pass < 3; pass++) {
  const [result] = await runEveryone(store, { ephemeral, model: standIn, connect: () => ({ api, mailbox }), log: () => {} });
  if (result?.error) throw new Error(`seed pass failed: ${result.error}`);
}
if (mailbox.modifyCalls > 0) throw new Error('seed pass changed the fake mailbox while sift was off');
// Each answered as the dashboard answers one, which is how a proposal from answers comes about.
for (const waiting of await pendingSuggestions(db, { accountId: ACCOUNT, sender: 'billing@utility.example.net' }))
  await applyFeedback(
    db,
    {
      accountId: ACCOUNT,
      sender: waiting.fromAddress,
      label: 'transactional',
      scope: 'once',
      decisionId: waiting.decisionId,
      messageId: waiting.messageId,
      carryOut: true,
    },
    now,
  );
if ((await listProposals(db, ACCOUNT)).length !== 1) throw new Error('seed answers did not propose a rule');
// A second mailbox of the same person, with no mail (connected after the passes, so none comes to it), to remove; and a second person, who owns nothing yet and
// takes over the install when the first deletes their account. Neither can be signed in to here.
await connectAccount(store, WORK, '1', now - 23 * HOUR, user);
await connectAccount(store, OTHER, '1', now - 22 * HOUR);
// A model in use, so the dashboard is not behind its connect-a-model wall. The key is made up, and this
// instance runs no passes, so nothing ever calls Anthropic with it.
await saveApiKey({ ...(await credentials(db, 'model', config.keys)), exclusive: (work) => work() }, 'anthropic', 'sk-ant-synthetic-seed');
await setModel(db, 'anthropic/claude-haiku-4-5');
await store.close();

// The same cookie `/auth/callback` sets (`signSession` in src/dashboard/server.ts), signed with this home's key.
const secret = randomBytes(32).toString('base64url');
writeSecret(config.dashboardKeyPath, secret, config.keys);
const body = Buffer.from(JSON.stringify({ e: ACCOUNT, p: user, x: now + 86_400_000 })).toString('base64url');
console.log(`${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`);
