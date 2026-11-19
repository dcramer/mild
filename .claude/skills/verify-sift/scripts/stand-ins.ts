/**
 * Preloaded into the Next.js server `serve.ts` starts (`NODE_OPTIONS=--import`), before any of Sift loads: it
 * offers the app stand-ins for what Sift reaches outside this machine for (`StandIns`, src/sift/sift.ts). Everything
 * else is the real app on the seeded home.
 *
 * - Gmail: nothing has happened since the seed's last pass, and each mailbox's filters are a fake mailbox's,
 *   starting from those the seed left in the file `SIFT_STAND_INS` names and written back there as they change.
 *   A search of the inbox finds nothing, or with `SIFT_STAND_INS_LISTING` set is still being listed for good, so
 *   applying a rule stays under way until it is stopped.
 * - The model that suggests labels and drafts rules, a stand-in. Drafting looks up the second line of its prompt
 *   (the words the person typed), then fills in a rule archiving and marking read mail from the first sender found,
 *   with a note naming the second; nothing found fills in `nobody@example.com`. Suggesting gives Sales pitches when
 *   the words name pitches, Build results (Digest) when they name builds, and notes that Receipts and transactions
 *   covers receipts already when they name receipts; words naming none of these are an unusable answer. A pass is given no model.
 * - What Gmail would count: an inbox of 2,412 messages (the newest 300 while setting up), three in four needing
 *   the model at about a tenth of a cent each; and for any rule about 1,240 messages it would decide, the newest
 *   five `Found in Gmail 1` to `5`, none needing the model.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import type { ExistingFilter } from '../../../../src/actions/filters.ts';
import type { StandIns } from '../../../../src/sift/sift.ts';
import type { GmailApi } from '../../../../src/gmail/api.ts';
import { PROPOSAL_TOOL } from '../../../../src/triage/proposal.ts';
import { FILL_TOOL, FIND_TOOL } from '../../../../src/triage/rule-draft.ts';
import { FakeMailbox } from '../../../../tests/helpers.ts';
import { seal } from '../../../../src/plain.ts';

const file = process.env['SIFT_STAND_INS'];
if (!file) throw new Error('SIFT_STAND_INS names no file of filters');
const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, ExistingFilter[]>;

/** A mailbox whose filters are written back to the file each time they change. */
class SavedMailbox extends FakeMailbox {
  override async createFilter(...args: Parameters<FakeMailbox['createFilter']>) {
    const made = await super.createFilter(...args);
    save();
    return made;
  }
  override async deleteFilter(id: string) {
    await super.deleteFilter(id);
    save();
  }
}
const mailboxes = new Map<string, SavedMailbox>();
const save = () => writeFileSync(file, JSON.stringify(Object.fromEntries([...mailboxes].map(([id, m]) => [id, m.filters])), null, 1));
const mailboxOf = (address: string) => {
  let mailbox = mailboxes.get(address);
  if (!mailbox) {
    mailbox = new SavedMailbox();
    mailbox.filters = saved[address] ?? [];
    mailboxes.set(address, mailbox);
  }
  return mailbox;
};

const listing = Boolean(process.env['SIFT_STAND_INS_LISTING']);
/** A Gmail where nothing has happened since the seed's last pass. */
const nothingNew = (address: string): GmailApi => ({
  getProfile: async () => ({ emailAddress: address, historyId: '1' }),
  listHistory: async () => ({ additions: [], historyId: '1' }),
  searchInbox: listing ? () => new Promise<never>(() => {}) : async () => ({ ids: [] }),
  inboxSize: async () => 0,
  getMetadata: async () => null,
  getLabelIds: async () => null,
  listLabels: async () => [],
  getContent: async () => null,
  getThread: async () => null,
  listSendAs: async () => [address],
});

/** What the stand-in reads of a call: the tools it is given come in a message of their own. */
type Context = { messages: readonly { role: string; content: unknown; toolsAdded?: readonly { name: string }[] }[] };

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
/** The words the person typed: the second line of the prompt. */
const typed = (context: Context) => String(context.messages.find((m) => m.role === 'user')?.content).split('\n')[1] ?? '';
// The rest of what `fill_rule` requires (src/model/draft-rule.ts), unused.
const blank = { reading: '', facts: [], name: '', label: '', onlyOnceLabelled: false, when: '', markRead: true, unsubscribe: false };
const PITCHES = {
  why: 'fewer pitches',
  name: 'Sales pitches',
  description: 'Unsolicited sales pitches from strangers and their follow-ups.',
  action: 'archive',
  markRead: false,
  unsubscribe: true,
};
const BUILDS = {
  why: 'builds only when one fails',
  name: 'Build results',
  description: 'Automated results of builds and test runs, passed or failed.',
  action: 'digest',
  markRead: false,
  unsubscribe: false,
};
const answer = (context: Context) => {
  // The stand-in takes a queue of answers, one a call: each puts the next in its place.
  faux.appendResponses([answer]);
  const tools = new Set(context.messages.flatMap((m) => m.toolsAdded ?? []).map((tool) => tool.name));
  if (tools.has(PROPOSAL_TOOL)) {
    const words = typed(context).toLowerCase();
    const note = words.includes('receipt') ? 'Your Receipts and transactions label covers receipts already.' : '';
    return fauxAssistantMessage(
      [fauxToolCall(PROPOSAL_TOOL, { labels: [...(words.includes('pitch') ? [PITCHES] : []), ...(words.includes('build') ? [BUILDS] : [])], note })],
      { stopReason: 'toolUse' },
    );
  }
  if (tools.has(FILL_TOOL) && context.messages.at(-1)?.role === 'toolResult') {
    const found = [...JSON.stringify(context.messages.at(-1)?.content).matchAll(/<([^>\s]+@[^>\s]+)>|- ([^\s,<]+@[^\s,]+)/g)].map((m) => m[1] ?? m[2]);
    const note = found[1] ? `Add another rule for ${found[1]}.` : '';
    return fauxAssistantMessage(
      [fauxToolCall(FILL_TOOL, { ...blank, conditions: [{ by: 'from', value: found[0] ?? 'nobody@example.com' }], action: 'archive', note })],
      { stopReason: 'toolUse' },
    );
  }
  if (tools.has(FIND_TOOL)) return fauxAssistantMessage([fauxToolCall(FIND_TOOL, { query: typed(context) })], { stopReason: 'toolUse' });
  return fauxAssistantMessage('The stand-in model answers only for labels and rules.', { stopReason: 'error', errorMessage: 'stand-in' });
};
faux.setResponses([answer, answer]);

const standIns: StandIns = {
  gmail: (address) => ({ api: nothingNew(address), mailbox: mailboxOf(address) }),
  model: { spec: 'faux/stand-in', models, model: faux.getModel(), reasoning: 'low' },
  inbox: {
    inboxEstimate: async (_db, _mailboxes, reach) =>
      reach === 'inbox' ? { messages: 2412, model: 1830, cost: 3.1 } : { messages: 300, model: 228, cost: 0.39 },
    ruleInbox: async () => ({
      examples: Array.from({ length: 5 }, (_, i) => ({
        accountId: 'me@example.org',
        messageId: `g${i + 1}`,
        subject: seal(`Found in Gmail ${i + 1}`),
        receivedAt: Date.now() - (i + 1) * 3_600_000,
      })),
      messages: 1240,
      reading: 0,
      exact: false,
      most: null,
      costEach: null,
    }),
  },
};
(globalThis as Record<symbol, unknown>)[Symbol.for('sift.stand-ins')] = standIns;
