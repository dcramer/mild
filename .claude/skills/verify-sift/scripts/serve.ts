#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * Verification scaffolding: the dashboard alone, running no pass, for a seeded home, with a fake Gmail behind its filter control.
 *
 *   node .claude/skills/verify-sift/scripts/serve.ts <home> <port> <gmail.json> [--work]
 *
 * `--work` also begins what is due for a person when they press for it (Check now, in Settings), as `sift run`
 * does: each piece a Workflow run delivered back to this process, a pass reading a Gmail with nothing new.
 *
 * Everything else is the real command's parts: the same store, controls, server, sign-in and policy. The one
 * control replaced is `ruleFilter`, which adds and removes a rule's Gmail filter (and is asked before any rule is
 * removed). It runs the real filter code against a fake mailbox holding the filters the seed left in
 * <gmail.json>, and writes them back there after each call. `inboxEstimate` answers for a fixed inbox of
 * 2,412 messages (the newest 300 while setting up), and `ruleInbox` for about 1,240 messages any rule would
 * decide, the newest five `Found in Gmail 1` to `5`, none needing the model. Every other control that reaches Gmail still finds no access. `draftRule` runs the real drafting (look-ups of the seeded senders, the `fill_rule` arguments read by
 * `readRuleDraft`, the `rule_drafts` row) with a stand-in model: it looks up the second line of its prompt (the
 * words the person typed), then fills in a rule archiving and marking read mail from the first sender found, with
 * a note naming the second. Nothing found fills in `nobody@example.com`. `proposeLabels` runs the real suggesting
 * the same way: its stand-in suggests Sales pitches when the words name pitches, and notes that Receipts and
 * transactions covers receipts already when they name receipts; words naming neither fail as an unusable answer.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { removeRuleFilter, writeRuleFilter } from '../../../../src/actions/rule-filters.ts';
import { nodeHost, serveDashboard } from '../../../../src/cli/host.ts';
import { ui } from '../../../../src/cli/ui.ts';
import { loadConfig } from '../../../../src/config.ts';
import { memoryEphemeral } from '../../../../src/ephemeral/ephemeral.ts';
import { createDashboard } from '../../../../src/dashboard/server.ts';
import { buildControls } from '../../../../src/app/controls.ts';
import { buildSignIn } from '../../../../src/app/google-sign-in.ts';
import type { ExistingFilter } from '../../../../src/actions/filters.ts';
import { listAccounts } from '../../../../src/store/accounts.ts';
import { people } from '../../../../src/store/people.ts';
import { openStore } from '../../../../src/store/store.ts';
import { FakeMailbox } from '../../../../tests/helpers.ts';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { proposeLabels } from '../../../../src/learn/labels.ts';
import { draftRule } from '../../../../src/learn/rules.ts';
import { createProposer } from '../../../../src/model/propose.ts';
import { createRuleDrafter } from '../../../../src/model/draft-rule.ts';
import { PROPOSAL_TOOL } from '../../../../src/triage/proposal.ts';
import { FILL_TOOL, FIND_TOOL } from '../../../../src/triage/rule-draft.ts';
import { begin, offerSift } from '../../../../src/app/process.ts';
import { runKey } from '../../../../src/app/sift.ts';
import type { GmailApi } from '../../../../src/gmail/api.ts';
import { type RunOptions, dueWork, runWork } from '../../../../src/work/run.ts';

const [home, port, gmailFile, flag] = process.argv.slice(2);
if (!home || !port || !gmailFile) throw new Error('usage: serve.ts <home> <port> <gmail.json> [--work]');
const working = flag === '--work';
process.env['SIFT_HOME'] = resolve(home);
const config = loadConfig();
const store = await openStore(config);
const ephemeral = memoryEphemeral();
const host = nodeHost(config, store, ephemeral, Number(port), (line) => ui.plain(line));

const saved = JSON.parse(readFileSync(gmailFile, 'utf8')) as Record<string, ExistingFilter[]>;
const mailboxes = new Map<string, FakeMailbox>();
const mailboxOf = (accountId: string) => {
  let mailbox = mailboxes.get(accountId);
  if (!mailbox) {
    mailbox = new FakeMailbox();
    mailbox.filters = saved[accountId] ?? [];
    mailboxes.set(accountId, mailbox);
  }
  return mailbox;
};
/** A Gmail where nothing has happened since the seed's last pass. */
const nothingNew = (address: string, historyId: string): GmailApi => ({
  getProfile: async () => ({ emailAddress: address, historyId }),
  listHistory: async () => ({ additions: [], historyId }),
  searchInbox: async () => ({ ids: [] }),
  inboxSize: async () => 0,
  getMetadata: async () => null,
  getLabelIds: async () => null,
  listLabels: async () => [],
  getContent: async () => null,
  getThread: async () => null,
  listSendAs: async () => [address],
});
const options: RunOptions = {
  ephemeral,
  log: (line) => ui.plain(line),
  connect: (_db, account) => ({ api: nothingNew(account.email, account.historyId ?? '1'), mailbox: mailboxOf(account.id) }),
};
if (working) offerSift(async () => ({ work: (piece) => runWork(store, piece, options, Date.now() + 60_000) }));
const built = await buildControls(config, {
  ephemeral,
  deviceId: 'verify-sift',
  running: working,
  ...(working
    ? {
        kick: async (person: number) => void (await Promise.all((await dueWork(store, options, [person])).map((piece) => begin(piece, runKey(piece))))),
      }
    : {}),
});
const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
// The rest of what `fill_rule` requires (src/model/draft-rule.ts), unused.
const blank = { reading: '', facts: [], name: '', label: '', onlyOnceLabelled: false, when: '', markRead: true, unsubscribe: false };
const lookUp = (context: { messages: readonly { role: string; content: unknown }[] }) => {
  const asked = context.messages.find((m) => m.role === 'user')?.content;
  const words = String(asked).split('\n')[1] ?? '';
  return fauxAssistantMessage([fauxToolCall(FIND_TOOL, { query: words })], { stopReason: 'toolUse' });
};
const fillIn = (context: { messages: readonly { role: string; content: unknown }[] }) => {
  const found = [...JSON.stringify(context.messages.at(-1)?.content).matchAll(/<([^>\s]+@[^>\s]+)>|- ([^\s,<]+@[^\s,]+)/g)].map((m) => m[1] ?? m[2]);
  const note = found[1] ? `Add another rule for ${found[1]}.` : '';
  return fauxAssistantMessage(
    [fauxToolCall(FILL_TOOL, { ...blank, conditions: [{ by: 'from', value: found[0] ?? 'nobody@example.com' }], action: 'archive', note })],
    { stopReason: 'toolUse' },
  );
};
const PITCHES = {
  why: 'fewer pitches',
  name: 'Sales pitches',
  description: 'Unsolicited sales pitches from strangers and their follow-ups.',
  action: 'archive',
  markRead: false,
  unsubscribe: true,
};
const suggest = (context: { messages: readonly { role: string; content: unknown }[] }) => {
  const words =
    String(context.messages.find((m) => m.role === 'user')?.content)
      .split('\n')[1]
      ?.toLowerCase() ?? '';
  const note = words.includes('receipt') ? 'Your Receipts and transactions label covers receipts already.' : '';
  return fauxAssistantMessage([fauxToolCall(PROPOSAL_TOOL, { labels: words.includes('pitch') ? [PITCHES] : [], note })], { stopReason: 'toolUse' });
};
const controls = {
  ...built,
  // What Gmail would say of an inbox of 2,412 messages, with three in four needing the model at about a tenth of a cent each.
  inboxEstimate: async (_db: Parameters<typeof built.inboxEstimate>[0], _mailboxes: readonly string[], reach: 'inbox' | 'recent') =>
    reach === 'inbox' ? { messages: 2412, model: 1830, cost: 3.1 } : { messages: 300, model: 228, cost: 0.39 },
  ruleInbox: async () => ({
    examples: Array.from({ length: 5 }, (_, i) => ({
      accountId: 'me@example.org',
      messageId: `g${i + 1}`,
      subject: `Found in Gmail ${i + 1}`,
      receivedAt: Date.now() - (i + 1) * 3_600_000,
    })),
    messages: 1240,
    reading: 0,
    exact: false,
    most: null,
    costEach: null,
  }),
  proposeLabels: async (db: Parameters<typeof built.proposeLabels>[0], request: { accountId: string; goal: string }) => {
    faux.setResponses([suggest]);
    return await proposeLabels({ db, propose: createProposer(models, faux.getModel()), model: 'faux/stand-in' }, request);
  },
  draftRule: async (db: Parameters<typeof built.draftRule>[0], request: { accountId: string; goal: string }) => {
    faux.setResponses([lookUp, fillIn]);
    return await draftRule({ db, draft: createRuleDrafter(models, faux.getModel()), model: 'faux/stand-in' }, request);
  },
  // What `ruleFilter` in src/app/controls.ts does, with the fake mailboxes in place of each account's Gmail.
  ruleFilter: async (db: Parameters<typeof built.ruleFilter>[0], ruleId: string, on: boolean) => {
    let failed: unknown;
    for (const account of await listAccounts(db)) {
      const deps = { db, mailbox: mailboxOf(account.id) };
      await (on ? writeRuleFilter(deps, ruleId, account.id) : removeRuleFilter(deps, ruleId, account.id)).catch((error: unknown) => {
        failed ??= error;
      });
    }
    if (failed !== undefined) throw failed;
    writeFileSync(gmailFile, JSON.stringify(Object.fromEntries([...mailboxes].map(([id, m]) => [id, m.filters])), null, 1));
  },
};

// What createSift puts together for a host with no `begin`.
const sift = {
  respond: createDashboard(people(store), {
    allowedHosts: host.allowedHosts,
    signInAddresses: host.signInAddresses,
    ...(config.settings.cloud ? { cloud: true } : {}),
    controls,
    signIn: buildSignIn(config, store),
    sessionSecret: host.sessionSecret,
    ephemeral,
  }).handle,
};
const stop = await serveDashboard(config, sift, { port: Number(port) });
ui.info(
  working ? 'Only the dashboard is running, and what is due when pressed for.' : 'Only the dashboard is running. `sift run` also reads and classifies mail.',
);
await new Promise<void>((done) => {
  process.once('SIGINT', done);
  process.once('SIGTERM', done);
});
await stop();
await store.close();
