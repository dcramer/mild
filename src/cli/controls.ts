import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { undo } from '../actions/executor.ts';
import { removeRuleFilter, writeRuleFilter } from '../actions/rule-filters.ts';
import type { Config } from '../config.ts';
import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import { backfill } from '../daemon/backfill.ts';
import type { Controls, ModelSignIns } from '../dashboard/controls.ts';
import { forgetPassStatus, passStatus } from '../daemon/status.ts';
import type { Jobs } from '../daemon/jobs.ts';
import { createGmailApi, getMessageHtml } from '../gmail/api.ts';
import { interruptEvals, startEval } from '../learn/evals.ts';
import { clientFor, loadClientSecrets, revokeGrant } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { pacer } from '../gmail/quota.ts';
import { createJudge } from '../model/judge.ts';
import {
  type PendingRedirect,
  modelChoices,
  offerModel,
  openModels,
  recommendModel,
  resolveModel,
  saveApiKey,
  startChatGPTRedirect,
  startChatGPTSignIn,
} from '../model/models.ts';
import { listAccounts, listUsers, personOf } from '../store/accounts.ts';
import { getAction, lastStandingChange } from '../store/actions.ts';
import { credentials } from '../store/credentials.ts';
import { getRuleFilter } from '../store/filters.ts';
import { preferences } from '../store/preferences.ts';
import type { Sql } from '../store/sql.ts';
import type { Store } from '../store/store.ts';

/** A Gmail client for one of the person's mailboxes, with the sign-in kept in their database. */
async function gmailClient(config: Config, db: Sql, email: string) {
  const token = await (await credentials(db, 'gmail', config.keys)).read(email);
  if (token === null) throw new Error(`sift has no access to ${email}. Sign in to the dashboard with that account.`);
  return clientFor(loadClientSecrets(config), token);
}

/** Gmail for one of the person's mailboxes, with the sign-in kept in their database, each call paced under the mailbox's quota. */
export async function gmailFor(config: Config, ephemeral: Ephemeral, db: Sql, email: string) {
  const client = await gmailClient(config, db, email);
  const pace = pacer(ephemeral, email);
  return { client, pace, api: createGmailApi(client, pace), mailbox: createGmailMailbox(client, pace) };
}

/** One person's model providers, signed in with what is kept in their database. */
const modelsFor = async (config: Config, db: Sql) => openModels(await credentials(db, 'model', config.keys), config.settings.chatgptSignIn ?? 'device-code');

/**
 * The model tier of the person whose database `db` is, from their own choice and sign-in.
 * Null when they have chosen no model. Throws, with what to do, when they have chosen one they cannot reach.
 */
export async function openModelTier(config: Config, db: Sql) {
  const { model: spec } = await preferences(db);
  if (!spec) return null;
  const models = await modelsFor(config, db);
  const model = resolveModel(models, spec);
  if (!(await models.getAuth(model))) throw new Error(`Not signed in to ${model.provider}. Sign in under Settings in the dashboard.`);
  return { spec, judge: createJudge(models, model) };
}

/** A stable id for this installation, created on first use. ChatGPT registers the device under it. */
function deviceId(config: Config): string {
  if (existsSync(config.deviceIdPath)) return readFileSync(config.deviceIdPath, 'utf8').trim();
  const id = randomUUID();
  writeFileSync(config.deviceIdPath, id, { mode: 0o600 });
  return id;
}

/** What the dashboard may ask this process to do. See `Controls`. */
export async function buildControls(config: Config, store: Store, live: { ephemeral: Ephemeral; jobs?: Jobs; running: boolean }): Promise<Controls> {
  const everyone = async () => await Promise.all((await listUsers(store.central)).map((u) => store.user(u.id)));
  for (const db of await everyone()) await interruptEvals(db);
  const choices = modelChoices(config.settings.chatgptSignIn ?? 'device-code');
  // By person: a ChatGPT sign-in waiting on them, and a Sign in with ChatGPT waiting for its address.
  const pending = new Map<number, NonNullable<ModelSignIns['pending']>>();
  const redirects = new Map<number, PendingRedirect>();
  /** Pass the person's mailboxes now, not at the next tick. Nothing does while only the dashboard runs. */
  const passNow = async (db: Sql) => {
    if (!live.jobs) return;
    const person = await personOf(db);
    for (const account of await listAccounts(db)) live.jobs.send({ kind: 'pass', person, account: account.id });
  };
  return {
    models: async (db) => {
      const available = (await (await modelsFor(config, db)).getAvailable())
        .filter((m) => offerModel(m.provider, m.id))
        .map((m) => ({ provider: m.provider, id: m.id }));
      const recommended: Record<string, string> = {};
      for (const provider of new Set(available.map((m) => m.provider))) {
        const id = recommendModel(
          provider,
          available.filter((m) => m.provider === provider).map((m) => m.id),
        );
        if (id) recommended[provider] = `${provider}/${id}`;
      }
      return { models: available.map((m) => `${m.provider}/${m.id}`), recommended };
    },
    modelSignIns: async (db) => {
      const waiting = pending.get(await personOf(db));
      return {
        choices: choices.map((c) => ({ ...c })),
        signedIn: await (await credentials(db, 'model', config.keys)).keys(),
        pending:
          waiting && 'expiresAt' in waiting && waiting.expiresAt < Date.now()
            ? { error: waiting.code ? 'That code expired. Start again.' : 'That sign-in expired. Start again.' }
            : (waiting ?? null),
      };
    },
    signInChatGPT: async (db) => {
      const person = await personOf(db);
      if (choices[0]!.how === 'redirect') {
        const redirect = await startChatGPTRedirect(await credentials(db, 'model', config.keys), deviceId(config));
        redirects.set(person, redirect);
        const shown = { url: redirect.url, expiresAt: redirect.expiresAt };
        pending.set(person, shown);
        return shown;
      }
      const started = await startChatGPTSignIn(await modelsFor(config, db), deviceId(config));
      const shown = { code: started.code, url: started.url, expiresAt: started.expiresAt };
      pending.set(person, shown);
      started.done.then(
        () => {
          if (pending.get(person) === shown) pending.delete(person);
          passNow(db).catch(() => {});
        },
        (error: unknown) => {
          if (pending.get(person) === shown) pending.set(person, { error: error instanceof Error ? error.message : String(error) });
        },
      );
      return shown;
    },
    finishChatGPT: async (db, address) => {
      const person = await personOf(db);
      const redirect = redirects.get(person);
      if (!redirect) throw new Error('No ChatGPT sign-in is waiting. Start again.');
      await redirect.finish(address);
      if (redirects.get(person) === redirect) {
        redirects.delete(person);
        pending.delete(person);
      }
      await passNow(db);
    },
    saveModelKey: async (db, provider, key) => {
      if (!choices.some((c) => c.provider === provider && c.how === 'key')) throw new Error('That provider does not take an API key.');
      await saveApiKey(await credentials(db, 'model', config.keys), provider, key);
      await passNow(db);
    },
    signOutModel: async (db, provider) => {
      await (await credentials(db, 'model', config.keys)).remove(provider);
      const person = await personOf(db);
      pending.delete(person);
      redirects.delete(person);
    },
    undo: async (db, actionId) => {
      const action = await getAction(db, actionId);
      if (!action) throw new Error(`There is no change #${actionId}.`);
      const outcome = await undo({ db, mailbox: (await gmailFor(config, live.ephemeral, db, action.accountId)).mailbox }, actionId);
      if (outcome.status === 'done') return null;
      if (outcome.status === 'skipped') return 'Already put back by hand';
      throw new Error(outcome.reason);
    },
    backfill: async (days) => {
      let added = 0;
      for (const db of await everyone())
        for (const account of await listAccounts(db))
          added += await backfill(db, (await gmailFor(config, live.ephemeral, db, account.email)).api, account.id, days);
      return added;
    },
    putBack: async (db, accountId, messageId) => {
      const last = await lastStandingChange(db, accountId, messageId);
      if (last) await undo({ db, mailbox: (await gmailFor(config, live.ephemeral, db, accountId)).mailbox }, last.id);
      // The corrected decision is waiting to be carried out; do it now, not at the next interval.
      await passNow(db);
      return last !== null;
    },
    startEval: async (db, request) => {
      const tier = await openModelTier(config, db);
      if (!tier) throw new Error('Choose a model first.');
      return (await startEval({ db, judge: tier.judge, model: tier.spec }, request)).id;
    },
    ruleFilter: async (db, ruleId, on) => {
      const rule = await getRuleFilter(db, ruleId);
      if (!rule) throw new Error('That rule no longer exists.');
      const deps = { db, mailbox: (await gmailFor(config, live.ephemeral, db, rule.accountId)).mailbox };
      if (on) await writeRuleFilter(deps, ruleId);
      else await removeRuleFilter(deps, ruleId);
    },
    revokeGmail: async (db, email) => {
      await forgetPassStatus(live.ephemeral, email);
      // A token that no longer opens (the key changed) cannot be revoked from here, and must not stop the removal.
      const token = await (await credentials(db, 'gmail', config.keys)).read(email).catch(() => undefined);
      return token === null || (token !== undefined && (await revokeGrant(token)));
    },
    messageHtml: async (db, accountId, messageId) => {
      const { client, pace } = await gmailFor(config, live.ephemeral, db, accountId);
      return await getMessageHtml(client, pace, messageId);
    },
    checkNow: passNow,
    activity: async (mailboxes) => ({ running: live.running, ...(await passStatus(live.ephemeral, mailboxes)) }),
  };
}
