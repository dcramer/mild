#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * Verification scaffolding: fills an empty sift home with synthetic mail and prints a session cookie for it.
 *
 *   node .claude/skills/verify-sift/scripts/seed.ts <home>
 *
 * The mail goes through the real daemon pass (`runEveryone`, observing), so decisions, labels, suggestion
 * bodies and proposals are what sift itself would record. Only Gmail is faked, at the `GmailApi` and
 * `Mailbox` ports. Prints one line: the `sift_session` cookie value for the connected account.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../../../../src/config.ts';
import { runEveryone } from '../../../../src/daemon/run.ts';
import type { GmailApi, RawMessage } from '../../../../src/gmail/api.ts';
import { writeSecret } from '../../../../src/secrets.ts';
import { connectAccount } from '../../../../src/store/accounts.ts';
import { openStore } from '../../../../src/store/store.ts';
import { addRule } from '../../../../src/store/rules.ts';
import { FakeMailbox } from '../../../../tests/helpers.ts';

const ACCOUNT = 'me@example.org';

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
      { name: 'Authentication-Results', value: `mx.example.org; dmarc=pass header.from=${from.replace(/.*@|>.*/g, '')}` },
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
  mail('Deals <deals@promo.example.com>', '48 hours only: 30% off', 'Everything must go.', list('promo.example.com')),
  mail('CI <builds@ci.example.org>', 'Build failed on main', 'The build failed at step 3.'),
  mail('Ada Lovelace <ada@example.org>', 'Lunch on Thursday?', 'Are you free for lunch on Thursday?'),
  mail('Grace Hopper <grace@example.net>', 'Notes from the review', 'Attached are my notes.'),
  // Plainly bulk by its headers (list, one-click, a bulk service, Promotions), so the heuristics tier places it as Marketing.
  mail('Store <sale@store.example.com>', 'Winter sale starts now', 'Up to half off.', [...list('store.example.com'), { name: 'X-Mailgun-Sid', value: 'seed' }], [
    'CATEGORY_PROMOTIONS',
  ]),
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
  getContent: async (id) => {
    const m = find(id);
    return m ? { text: m.body, facts: { hasAttachments: false } } : null;
  },
  getThread: async () => null,
  getRaw: async () => null,
};

// A stand-in model that can place nothing, so what no rule covers becomes a question ("Which label?"):
// with no model at all it would wait, undecided, and never be asked about. It calls no provider.
const unsure = async () => ({ guidelines: '', judge: async () => ({ label: 'unsure', reason: 'synthetic: cannot tell', confidence: 0.3 }) });
const [result] = await runEveryone(store, { act: false, heuristics: true, model: unsure, connect: () => ({ api, mailbox }), log: () => {} });
if (result?.error) throw new Error(`seed pass failed: ${result.error}`);
if (mailbox.modifyCalls > 0) throw new Error('seed pass changed the fake mailbox while observing');
await store.close();

// The same cookie `/auth/callback` sets (`signSession` in src/dashboard/server.ts), signed with this home's key.
const secret = randomBytes(32).toString('base64url');
writeSecret(config.dashboardKeyPath, secret, config.keys);
const body = Buffer.from(JSON.stringify({ e: ACCOUNT, x: now + 86_400_000 })).toString('base64url');
console.log(`${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`);
