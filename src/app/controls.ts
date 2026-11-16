import { undo } from '../actions/executor.ts';
import { removeRuleFilter, writeRuleFilter } from '../actions/rule-filters.ts';
import type { Config } from '../config.ts';
import { type Ephemeral, holding } from '../ephemeral/ephemeral.ts';
import type { Controls } from '../dashboard/controls.ts';
import { forgetPassStatus, passStatus } from '../work/status.ts';
import { askForBackfill } from '../work/run.ts';
import { createGmailApi, getMessageHtml } from '../gmail/api.ts';
import { startEval } from '../learn/evals.ts';
import { clientFor, loadClientSecrets, revokeGrant } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { pacer } from '../gmail/quota.ts';
import { chatgptPending, checkChatGPT, finishChatGPT, forgetChatGPT, startChatGPT } from './chatgpt.ts';
import type { SignIns } from '../model/credentials.ts';
import { createJudge } from '../model/judge.ts';
import { modelChoices, offerModel, openModels, recommendModel, resolveModel, saveApiKey } from '../model/models.ts';
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
  if (token === null) throw new Error(`Sift has no access to ${email}. Sign in to the dashboard with that account.`);
  return clientFor(loadClientSecrets(config), token);
}

/** Gmail for one of the person's mailboxes, with the sign-in kept in their database, each call paced under the mailbox's quota. */
export async function gmailFor(config: Config, ephemeral: Ephemeral, db: Sql, email: string) {
  const client = await gmailClient(config, db, email);
  const pace = pacer(ephemeral, email);
  return { client, pace, api: createGmailApi(client, pace), mailbox: createGmailMailbox(client, pace) };
}

/** One person's model sign-ins, kept in their database and changed by one process at a time. */
async function modelSignIns(config: Config, ephemeral: Ephemeral, db: Sql): Promise<SignIns> {
  const person = await personOf(db);
  return { ...(await credentials(db, 'model', config.keys)), exclusive: (work) => holding(ephemeral, `lock:signin:${person}`, work) };
}

/** One person's model providers, signed in with what is kept in their database. */
const modelsFor = async (config: Config, ephemeral: Ephemeral, db: Sql) =>
  openModels(await modelSignIns(config, ephemeral, db), config.settings.chatgptSignIn ?? 'device-code');

/**
 * The model tier of the person whose database `db` is, from their own choice and sign-in.
 * Null when they have chosen no model. Throws, with what to do, when they have chosen one they cannot reach.
 */
export async function openModelTier(config: Config, ephemeral: Ephemeral, db: Sql) {
  const { model: spec } = await preferences(db);
  if (!spec) return null;
  const models = await modelsFor(config, ephemeral, db);
  const model = resolveModel(models, spec);
  if (!(await models.getAuth(model))) throw new Error(`Not signed in to ${model.provider}. Sign in under Settings in the dashboard.`);
  return { spec, judge: createJudge(models, model) };
}

/** What the dashboard may ask this process to do. See `Controls`. */
export async function buildControls(
  config: Config,
  store: Store,
  live: { ephemeral: Ephemeral; deviceId: string; kick?: (person?: number) => void; running: boolean },
): Promise<Controls> {
  const choices = modelChoices(config.settings.chatgptSignIn ?? 'device-code');
  /** Pass the person's mailboxes now, not at the next tick. Nothing does while only the dashboard runs. */
  const passNow = async (db: Sql) => live.kick?.(await personOf(db));
  return {
    models: async (db) => {
      const available = (await (await modelsFor(config, live.ephemeral, db)).getAvailable())
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
      const person = await personOf(db);
      const signIns = await modelSignIns(config, live.ephemeral, db);
      // Signed in just now: their mail has a model to go to.
      if ((await checkChatGPT(live.ephemeral, person, signIns)) === 'done') await passNow(db);
      return { choices: choices.map((c) => ({ ...c })), signedIn: await signIns.keys(), pending: await chatgptPending(live.ephemeral, person) };
    },
    signInChatGPT: async (db) => {
      const person = await personOf(db);
      const how = choices[0]!.how === 'redirect' ? 'redirect' : 'device-code';
      return await startChatGPT(live.ephemeral, person, how, live.deviceId);
    },
    finishChatGPT: async (db, address) => {
      await finishChatGPT(live.ephemeral, await personOf(db), await modelSignIns(config, live.ephemeral, db), address);
      await passNow(db);
    },
    saveModelKey: async (db, provider, key) => {
      if (!choices.some((c) => c.provider === provider && c.how === 'key')) throw new Error('That provider does not take an API key.');
      await saveApiKey(await modelSignIns(config, live.ephemeral, db), provider, key);
      await passNow(db);
    },
    signOutModel: async (db, provider) => {
      await (await modelSignIns(config, live.ephemeral, db)).remove(provider);
      await forgetChatGPT(live.ephemeral, await personOf(db));
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
      if (!live.kick) throw new Error('Only the dashboard is running here, so nothing can pull in mail.');
      for (const user of await listUsers(store.central))
        for (const account of await listAccounts(await store.user(user.id))) await askForBackfill(live.ephemeral, account.id, days);
      live.kick();
    },
    putBack: async (db, accountId, messageId) => {
      const last = await lastStandingChange(db, accountId, messageId);
      if (last) await undo({ db, mailbox: (await gmailFor(config, live.ephemeral, db, accountId)).mailbox }, last.id);
      // The corrected decision is waiting to be carried out; do it now, not at the next interval.
      await passNow(db);
      return last !== null;
    },
    startEval: async (db, request) => {
      const tier = await openModelTier(config, live.ephemeral, db);
      if (!tier) throw new Error('Choose a model first.');
      const run = await startEval({ db, model: tier.spec }, request);
      live.kick?.(await personOf(db));
      return run;
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
