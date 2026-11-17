#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * Verification scaffolding: `sift dashboard` for a seeded home, with a fake Gmail behind its filter control.
 *
 *   node .claude/skills/verify-sift/scripts/serve.ts <home> <port> <gmail.json>
 *
 * Everything else is the real command's parts: the same store, controls, server, sign-in and policy. The one
 * control replaced is `ruleFilter`, which adds and removes a rule's Gmail filter (and is asked before any rule is
 * removed). It runs the real filter code against a fake mailbox holding the filters the seed left in
 * <gmail.json>, and writes them back there after each call. Every other control that reaches Gmail still finds
 * no access.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { removeRuleFilter, writeRuleFilter } from '../../../../src/actions/rule-filters.ts';
import { nodeHost, serveDashboard } from '../../../../src/cli/host.ts';
import { WEB_DIST } from '../../../../src/cli/web-build.ts';
import { site } from '../../../../src/app/site.ts';
import { ui } from '../../../../src/cli/ui.ts';
import { loadConfig } from '../../../../src/config.ts';
import { memoryEphemeral } from '../../../../src/ephemeral/ephemeral.ts';
import { createDashboard } from '../../../../src/dashboard/server.ts';
import { buildControls } from '../../../../src/app/controls.ts';
import { buildSignIn } from '../../../../src/app/google-sign-in.ts';
import type { ExistingFilter } from '../../../../src/actions/filters.ts';
import { Refusal } from '../../../../src/refusal.ts';
import { getRuleFilter } from '../../../../src/store/filters.ts';
import { people } from '../../../../src/store/people.ts';
import { openStore } from '../../../../src/store/store.ts';
import { FakeMailbox } from '../../../../tests/helpers.ts';

const [home, port, gmailFile] = process.argv.slice(2);
if (!home || !port || !gmailFile) throw new Error('usage: serve.ts <home> <port> <gmail.json>');
process.env['SIFT_HOME'] = resolve(home);
const config = loadConfig();
const store = await openStore(config);
const ephemeral = memoryEphemeral();
const host = nodeHost(config, store, ephemeral, Number(port), (line) => ui.plain(line));
const built = await buildControls(config, store, { ephemeral, deviceId: 'verify-sift', running: false });

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
const controls = {
  ...built,
  // What `ruleFilter` in src/app/controls.ts does, with the fake mailbox in place of the account's Gmail.
  ruleFilter: async (db: Parameters<typeof built.ruleFilter>[0], ruleId: string, on: boolean) => {
    const rule = await getRuleFilter(db, ruleId);
    if (!rule) throw new Refusal('That rule no longer exists.');
    const deps = { db, mailbox: mailboxOf(rule.accountId) };
    if (on) await writeRuleFilter(deps, ruleId);
    else await removeRuleFilter(deps, ruleId);
    writeFileSync(gmailFile, JSON.stringify(Object.fromEntries([...mailboxes].map(([id, m]) => [id, m.filters])), null, 1));
  },
};

// What createSift puts together for `sift dashboard`.
const sift = {
  respond: site(
    createDashboard(people(store), {
      allowedHosts: host.allowedHosts,
      signInAddresses: host.signInAddresses,
      controls,
      signIn: buildSignIn(config, store),
      sessionSecret: host.sessionSecret,
      ephemeral,
    }),
    WEB_DIST,
  ),
};
const stop = await serveDashboard(config, sift, { port: Number(port) });
ui.info('Only the dashboard is running. `sift run` also reads and classifies mail.');
await new Promise<void>((done) => {
  process.once('SIGINT', done);
  process.once('SIGTERM', done);
});
stop();
await store.close();
