import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { type Scope, scopeFor } from '../src/dashboard/scope.ts';
import type { SignIn } from '../src/dashboard/controls.ts';
import type { Sql } from '../src/store/sql.ts';
import type { SignIns } from '../src/model/credentials.ts';
import { listAccounts } from '../src/store/accounts.ts';
import { recordSync } from '../src/store/messages.ts';
import { examples, labels } from '../src/store/query.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { exampleKeysOf, sealPart } from '../src/store/content.ts';
import type { Judge, Verdict } from '../src/triage/stages/model.ts';
import type { Address, Label, MessageFacts } from '../src/triage/types.ts';
import { type RunOptions, dueWork, runWork } from '../src/work/run.ts';
import { type PassResult } from '../src/work/pass.ts';
import type { Store } from '../src/store/store.ts';

/** The mailbox a test's person signs in with, unless it needs another. */
export const ACCOUNT = 'me@example.org';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const tempDir = () => mkdtempSync(join(tmpdir(), 'sift-'));

/** Text as a Gmail message part carries it. */
export const b64 = (text: string) => Buffer.from(text).toString('base64url');

/** A verdict that places nothing: the model was not sure. */
export const UNSURE: Verdict = { label: 'unsure', reason: 'cannot tell', confidence: 0.2 };

/** The model's answer that calls `tool` with `args`, as pi-ai's faux provider replies. */
export const toolReply = (tool: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: 'toolUse' });

/** A label the model proposes, as its tool records it: Cold outreach, archived and unsubscribed from. */
export const PITCHES = {
  why: 'fewer pitches',
  name: 'Cold outreach',
  description: 'Pitches from strangers.',
  action: 'archive',
  markRead: false,
  unsubscribe: true,
};

/** The id an install names itself by when it signs in to ChatGPT. */
export const DEVICE = '00000000-0000-4000-8000-000000000001';

/** The model tier, with calls recorded as `test/model`. */
export const testModel = (judge: Judge = async () => UNSURE) => ({ model: 'test/model', judge });

/** What a pass or a tick runs with in a test: its own ephemeral store and no log, unless `more` says otherwise. */
export const runOptions = (more: Pick<RunOptions, 'connect'> & Partial<RunOptions>): RunOptions => ({ ephemeral: memoryEphemeral(), log: () => {}, ...more });

/** A model that places nothing: what it is asked about is left for review. With no model, nothing is asked. */
export const unsureModel = async () => testModel();

/** A Google sign-in whose code stands in for the Google account that came back. */
export const codeSignIn: SignIn = {
  hasClient: () => true,
  url: (_redirect, state) => `https://accounts.example/auth?state=${state}`,
  complete: async (_redirect, code) => code,
};

/** Sign-ins kept in memory, as a person's database keeps them. */
export function memorySignIns(): SignIns & { stored: Map<string, string> } {
  const stored = new Map<string, string>();
  return {
    stored,
    read: async (provider) => stored.get(provider) ?? null,
    write: async (provider, text) => void stored.set(provider, text),
    remove: async (provider) => void stored.delete(provider),
    keys: async () => [...stored.keys()].toSorted(),
    exclusive: (work) => work(),
  };
}

/** An address as a message's facts hold it, its domain what follows the @. */
export const email = (address: string, name?: string): Address => ({ address, domain: address.split('@')[1] ?? '', ...(name ? { name } : {}) });

const header = (a: Address) => (a.name ? `${a.name} <${a.address}>` : a.address);

/** A synthetic message, with headers that say what it does, as Gmail's would. Tests never use real mail. */
export function facts(overrides: Partial<MessageFacts> = {}): MessageFacts {
  const message = {
    accountId: ACCOUNT,
    messageId: 'm1',
    threadId: 't1',
    from: email('news@example.com'),
    to: [email(ACCOUNT)],
    cc: [],
    subject: 'Weekly digest',
    labelIds: ['INBOX', 'UNREAD'],
    receivedAt: 0,
    ...overrides,
  };
  return {
    ...message,
    headers: {
      from: header(message.from),
      to: message.to.map(header).join(', '),
      ...(message.cc.length > 0 ? { cc: message.cc.map(header).join(', ') } : {}),
      subject: message.subject,
      ...overrides.headers,
    },
  };
}

/** A message the user answered for, stored whole as `captureExamples` would leave it. */
export async function storeExample(
  db: Sql,
  accountId: string,
  example: {
    id: string;
    from: string;
    label: string;
    subject?: string;
    body?: string;
    markedAt?: number;
    receivedAt?: number;
    name?: string;
    headers?: Record<string, string>;
  },
): Promise<void> {
  await recordSync(
    db,
    accountId,
    [
      facts({
        accountId,
        messageId: example.id,
        from: email(example.from, example.name),
        subject: example.subject ?? `Subject ${example.id}`,
        headers: example.headers ?? {},
        receivedAt: example.receivedAt ?? 0,
      }),
    ],
    '2',
  );
  await recordDecision(db, accountId, example.id, {
    disposition: 'review',
    subscription: 'preserve',
    stage: 'fallback',
    reason: 'no stage reached a decision',
  });
  await db.insert(examples).values({
    accountId,
    messageId: example.id,
    labelId: example.label,
    markedAt: example.markedAt ?? 0,
    status: 'captured',
    bodyText: sealPart(db, accountId, example.id, 'text', example.body ?? `Body of ${example.id}`),
    ...(await exampleKeysOf(db, accountId, example.id)),
  });
}

/** A scope that sees every connected account, as the dashboard has when no sign-in is set up. */
export const everything = async (db: Sql): Promise<Scope> =>
  scopeFor(
    (await listAccounts(db)).map((a) => a.id),
    true,
  );

/** The labels a mailbox in a test has unless it says otherwise: the starting set Mild once gave everyone. */
export const SAMPLE_LABELS: readonly Label[] = [
  {
    id: 'personal',
    name: 'Personal',
    description:
      'Written by a person to the owner or a small group, however short or oddly written: conversation, a direct request, an introduction, a reply in a conversation the owner took part in, a stranger writing about something particular to the owner. Not mail a company sends, however much the owner wants it.',
    disposition: 'keep',
    gmailLabel: 'mild/personal',
  },
  {
    id: 'security',
    name: 'Account alerts',
    description:
      "Something about the owner's own account that may need them: sign-in alerts, password resets, verification codes, a locked or changed account, a failed payment, a bill due, a card expiring, a renewal about to charge. However alarming, when the sender is who they claim to be. Not a change to terms or a privacy policy.",
    disposition: 'keep',
    gmailLabel: 'mild/security',
  },
  {
    id: 'transactional',
    name: 'Receipts',
    description:
      'A record of something the owner did: receipts and paid invoices, order confirmations, shipping and delivery updates, bookings, statements, tax documents. Even from a company that also sends promotions, or one they have not had mail from before. Not something they still have to pay or do.',
    disposition: 'archive',
    gmailLabel: 'mild/receipts',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description:
      "An invitation to a meeting or event from a person, or a change or cancellation to one the owner is in. Not replies to the owner's own invitations or automatic reminders, nor an event a company invites a whole list to.",
    disposition: 'keep',
    gmailLabel: 'mild/calendar',
  },
  {
    id: 'request',
    name: 'Asks for you',
    description:
      'Automated mail from a service where someone asks the owner in particular to do something: a review requested, an assignment, a mention, an approval or a question waiting on them. Not activity they are only watching.',
    disposition: 'keep',
    gmailLabel: 'mild/asks',
  },
  {
    id: 'notification',
    name: 'Notifications',
    description:
      'Automated activity from a service the owner uses that asks nothing of them: comments and changes on things they watch, builds, alerts, reports, digests, replies to their invitations, reminders, changes to terms or privacy policies.',
    disposition: 'archive',
    gmailLabel: 'mild/notifications',
  },
  {
    id: 'newsletter',
    name: 'Newsletters',
    description: 'Editorial or community content from a list the owner subscribed to: writers, publications, digests, community mailing lists.',
    disposition: 'archive',
    gmailLabel: 'mild/newsletters',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description:
      'Promotions, sales, product announcements, events and re-engagement mail a company sends to a whole list, whether the owner wants it or never asked for it. Not mail about the owner in particular: their order, account or support request.',
    disposition: 'archive',
    gmailLabel: 'mild/marketing',
  },
  {
    id: 'cold_outreach',
    name: 'Cold outreach',
    description:
      'An unsolicited pitch from a stranger, written from a template or sent as a sequence of follow-ups: sales, recruiting, partnerships, guest posts, fundraising, surveys. Not someone the owner has written to or who is answering them, nor a stranger writing about something particular to the owner.',
    disposition: 'archive',
    gmailLabel: 'mild/cold-outreach',
    unsubscribe: true,
  },
  {
    id: 'phishing',
    name: 'Scams and phishing',
    description:
      'An attempt to deceive the owner: a fake sign-in, invoice, delivery or security notice, a request for credentials, payment or gift cards, a scam or deceptive offer, or a sender pretending to be a person or company they are not. Being unexpected or from a new sender is not enough.',
    disposition: 'spam',
    gmailLabel: 'mild/phishing',
  },
];

/** Give the person the sample labels, before their Leave in inbox, unless they have them. */
export async function withSampleLabels(db: Sql): Promise<void> {
  await db
    .insert(labels)
    .values(
      SAMPLE_LABELS.map((l, position) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        disposition: l.disposition,
        gmailLabel: l.gmailLabel ?? null,
        position,
        unsubscribe: l.unsubscribe ?? false,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Each piece due, one after another in this process, each starting nothing after `limitMs` from its own start:
 * what Workflow runs do on a host, without Workflow.
 */
export async function workDue(store: Store, options: RunOptions, limitMs: number, people?: readonly number[]): Promise<PassResult[]> {
  const results: PassResult[] = [];
  for (const piece of await dueWork(store, options, people)) {
    const result = await runWork(store, piece, options, (options.now ?? Date.now)() + limitMs);
    if (result) results.push(result);
  }
  return results;
}
