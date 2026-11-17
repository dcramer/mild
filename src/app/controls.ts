import { undo } from '../actions/executor.ts';
import { removeRuleFilter, writeRuleFilter } from '../actions/rule-filters.ts';
import type { Config } from '../config.ts';
import { type Ephemeral, holding } from '../ephemeral/ephemeral.ts';
import type { Controls } from '../dashboard/controls.ts';
import { forgetPassStatus, passStatus } from '../work/status.ts';
import { REACH, modelShare } from '../store/inbox.ts';
import { averageCall } from '../store/runs.ts';
import { hasOwnLabels } from '../store/labels.ts';
import { applyRule, ruleInbox } from '../work/apply.ts';
import { createGmailApi } from '../gmail/api.ts';
import { startEval } from '../learn/evals.ts';
import { proposeLabels } from '../learn/labels.ts';
import { draftRule } from '../learn/rules.ts';
import { clientFor, loadClientSecrets, revokeGrant } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { pacer } from '../gmail/quota.ts';
import { chatgptPending, checkChatGPT, finishChatGPT, forgetChatGPT, startChatGPT } from './chatgpt.ts';
import type { SignIns } from '../model/credentials.ts';
import { createJudge } from '../model/judge.ts';
import { createProposer } from '../model/propose.ts';
import { createRuleDrafter } from '../model/draft-rule.ts';
import { modelChoices, offerModel, openModels, priceOf, resolveModel, saveApiKey, shortlistModels } from '../model/models.ts';
import { listAccounts, personOf } from '../store/accounts.ts';
import { getAction, lastStandingChange } from '../store/actions.ts';
import { credentials } from '../store/credentials.ts';
import { getRuleFilter } from '../store/filters.ts';
import { preferences } from '../store/preferences.ts';
import type { Sql } from '../store/sql.ts';
import { Refusal } from '../refusal.ts';

const DAY_MS = 86_400_000;
/** How far back an estimate looks for how much mail went to the model: recent enough to reflect the rules as they are. */
const ESTIMATE_DAYS = 30;

/** A Gmail client for one of the person's mailboxes, with the sign-in kept in their database. */
async function gmailClient(config: Config, db: Sql, email: string) {
  const token = await (await credentials(db, 'gmail')).read(email);
  if (token === null) throw new Refusal(`Sift has no access to ${email}. Sign in to the dashboard with that account.`);
  return clientFor(loadClientSecrets(config), token);
}

/** Gmail for one of the person's mailboxes, with the sign-in kept in their database, each call paced under the mailbox's quota. */
export async function gmailFor(config: Config, ephemeral: Ephemeral, db: Sql, email: string) {
  const client = await gmailClient(config, db, email);
  const pace = pacer(ephemeral, email);
  return { client, pace, api: createGmailApi(client, pace), mailbox: createGmailMailbox(client, pace) };
}

/** One person's model sign-ins, kept in their database and changed by one process at a time. */
async function modelSignIns(ephemeral: Ephemeral, db: Sql): Promise<SignIns> {
  const person = await personOf(db);
  return { ...(await credentials(db, 'model')), exclusive: (work) => holding(ephemeral, `lock:signin:${person}`, work) };
}

/** One person's model providers, signed in with what is kept in their database. */
const modelsFor = async (config: Config, ephemeral: Ephemeral, db: Sql) =>
  openModels(await modelSignIns(ephemeral, db), config.settings.chatgptSignIn ?? 'device-code');

/**
 * The model tier of the person whose database `db` is, from their own choice and sign-in.
 * Null when they have chosen no model. Throws, with what to do, when they have chosen one they cannot reach.
 */
async function openModel(config: Config, ephemeral: Ephemeral, db: Sql) {
  const { model: spec } = await preferences(db);
  if (!spec) return null;
  const models = await modelsFor(config, ephemeral, db);
  const model = resolveModel(models, spec);
  if (!(await models.getAuth(model))) throw new Refusal(`Not signed in to ${model.provider}. Sign in under Settings in the dashboard.`);
  return { spec, models, model };
}

export async function openModelTier(config: Config, ephemeral: Ephemeral, db: Sql) {
  const opened = await openModel(config, ephemeral, db);
  return opened && { spec: opened.spec, judge: createJudge(opened.models, opened.model) };
}

/** What the dashboard may ask this process to do. See `Controls`. */
export async function buildControls(
  config: Config,
  live: { ephemeral: Ephemeral; deviceId: string; kick?: (person?: number) => void; running: boolean },
): Promise<Controls> {
  const choices = modelChoices(config.settings.chatgptSignIn ?? 'device-code');
  /** Pass the person's mailboxes now, not at the next tick. Nothing does while only the dashboard runs. */
  const passNow = async (db: Sql) => live.kick?.(await personOf(db));
  /** The size of the person's own calls lately, in tokens, which is their mail and their labels more than the model; undefined for a typical call's. */
  const usualCall = async (db: Sql) => {
    const usual = await averageCall(db);
    return usual ? { input: usual.inputTokens, output: usual.outputTokens } : undefined;
  };
  /**
   * What classifying one message costs the person on their model, in dollars: what their calls on it have cost
   * lately, else their usual call at its catalog price. Through ChatGPT, what the same use would cost through
   * the API. Null when they have no model or its price is not known.
   */
  const costEach = async (db: Sql) => {
    const { model: spec } = await preferences(db);
    if (!spec) return null;
    return (await averageCall(db, spec))?.costUsd ?? priceOf(resolveModel(await modelsFor(config, live.ephemeral, db), spec).cost, await usualCall(db));
  };
  return {
    models: async (db) => {
      const available = (await (await modelsFor(config, live.ephemeral, db)).getAvailable()).filter((m) => offerModel(m.provider, m.id));
      const shortlist: Record<string, string[]> = {};
      for (const provider of new Set(available.map((m) => m.provider))) {
        const ids = shortlistModels(
          provider,
          available.filter((m) => m.provider === provider).map((m) => m.id),
        );
        if (ids.length > 0) shortlist[provider] = ids.map((id) => `${provider}/${id}`);
      }
      // Each priced for the same calls, so they compare.
      const tokens = await usualCall(db);
      const costs: Record<string, number> = {};
      for (const m of available) {
        const each = priceOf(m.cost, tokens);
        if (each !== null) costs[`${m.provider}/${m.id}`] = each * 1000;
      }
      return { models: available.map((m) => `${m.provider}/${m.id}`), shortlist, costs };
    },
    modelSignIns: async (db) => {
      const person = await personOf(db);
      const signIns = await modelSignIns(live.ephemeral, db);
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
      await finishChatGPT(live.ephemeral, await personOf(db), await modelSignIns(live.ephemeral, db), address);
      await passNow(db);
    },
    saveModelKey: async (db, provider, key) => {
      if (!choices.some((c) => c.provider === provider && c.how === 'key')) throw new Refusal('That provider does not take an API key.');
      await saveApiKey(await modelSignIns(live.ephemeral, db), provider, key);
      await passNow(db);
    },
    signOutModel: async (db, provider) => {
      await (await modelSignIns(live.ephemeral, db)).remove(provider);
      await forgetChatGPT(live.ephemeral, await personOf(db));
    },
    undo: async (db, actionId) => {
      const action = await getAction(db, actionId);
      if (!action) throw new Refusal(`There is no change #${actionId}.`);
      const outcome = await undo({ db, mailbox: (await gmailFor(config, live.ephemeral, db, action.accountId)).mailbox }, actionId);
      if (outcome.status === 'done') return null;
      if (outcome.status === 'skipped') return 'Already put back by hand';
      throw new Refusal(outcome.reason);
    },
    inboxEstimate: async (db, mailboxes, reach) => {
      let messages = 0;
      for (const account of await listAccounts(db)) {
        if (!mailboxes.includes(account.id) || !(await hasOwnLabels(db, account.id))) continue;
        messages += Math.min(await (await gmailFor(config, live.ephemeral, db, account.id)).api.inboxSize(), REACH[reach]);
      }
      // As much of it as went to the model lately; with nothing to go by, all of it.
      const model = Math.round(messages * ((await modelShare(db, Date.now() - ESTIMATE_DAYS * DAY_MS)) ?? 1));
      const each = await costEach(db);
      return { messages, model, cost: each === null ? null : model * each };
    },
    putBack: async (db, accountId, messageId) => {
      const last = await lastStandingChange(db, accountId, messageId);
      if (last) await undo({ db, mailbox: (await gmailFor(config, live.ephemeral, db, accountId)).mailbox }, last.id);
      // The corrected decision is waiting to be carried out; do it now, not at the next interval.
      await passNow(db);
    },
    startEval: async (db, request) => {
      const tier = await openModelTier(config, live.ephemeral, db);
      if (!tier) throw new Refusal('Choose a model first.');
      const run = await startEval({ db, model: tier.spec }, request);
      live.kick?.(await personOf(db));
      return run;
    },
    proposeLabels: async (db, request) => {
      const opened = await openModel(config, live.ephemeral, db);
      if (!opened) throw new Refusal('Choose a model first.');
      return await proposeLabels({ db, propose: createProposer(opened.models, opened.model), model: opened.spec }, request);
    },
    draftRule: async (db, request) => {
      const opened = await openModel(config, live.ephemeral, db);
      if (!opened) throw new Refusal('Choose a model first.');
      return await draftRule({ db, draft: createRuleDrafter(opened.models, opened.model), model: opened.spec }, request);
    },
    ruleFilter: async (db, ruleId, on) => {
      const rule = await getRuleFilter(db, ruleId);
      if (!rule) throw new Refusal('That rule no longer exists.');
      const deps = { db, mailbox: (await gmailFor(config, live.ephemeral, db, rule.accountId)).mailbox };
      if (on) await writeRuleFilter(deps, ruleId);
      else await removeRuleFilter(deps, ruleId);
    },
    ruleInbox: async (db, ruleId) => {
      const rule = await getRuleFilter(db, ruleId);
      if (!rule) throw new Refusal('That rule no longer exists.');
      const { api } = await gmailFor(config, live.ephemeral, db, rule.accountId);
      const { matches, capped } = await ruleInbox(db, api, rule.accountId, ruleId);
      return { matches: matches.map((m) => ({ accountId: rule.accountId, ...m })), capped, costEach: await costEach(db) };
    },
    applyRule: async (db, ruleId, messageIds) => {
      const rule = await getRuleFilter(db, ruleId);
      if (!rule) throw new Refusal('That rule no longer exists.');
      const { api } = await gmailFor(config, live.ephemeral, db, rule.accountId);
      const applied = await applyRule(db, api, rule.accountId, ruleId, messageIds);
      await passNow(db);
      return applied;
    },
    revokeGmail: async (db, email) => {
      await forgetPassStatus(live.ephemeral, email);
      // A token that no longer opens (the key changed) cannot be revoked from here, and must not stop the removal.
      const token = await (await credentials(db, 'gmail')).read(email).catch(() => undefined);
      return token === null || (token !== undefined && (await revokeGrant(token)));
    },
    checkNow: passNow,
    activity: async (mailboxes) => ({ running: live.running, ...(await passStatus(live.ephemeral, mailboxes)) }),
  };
}
