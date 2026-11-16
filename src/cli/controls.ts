import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { undo } from '../actions/executor.ts';
import { removeRuleFilter, writeRuleFilter } from '../actions/rule-filters.ts';
import { type Config, loadConfig, saveSettings } from '../config.ts';
import { backfill } from '../daemon/backfill.ts';
import type { Activity, Controls, ModelSignIns } from '../dashboard/controls.ts';
import { rejudgeWaiting } from '../daemon/rejudge.ts';
import type { Wake } from '../daemon/run.ts';
import { createGmailApi } from '../gmail/api.ts';
import { interruptEvals, startEval } from '../learn/evals.ts';
import { clientFor, loadClientSecrets } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { createJudge } from '../model/judge.ts';
import { MODEL_CHOICES, openModels, recommendModel, resolveModel, saveApiKey, startChatGPTSignIn } from '../model/models.ts';
import { listAccounts, listUsers, personOf } from '../store/accounts.ts';
import { getAction, lastStandingChange } from '../store/actions.ts';
import { credentials } from '../store/credentials.ts';
import { getRuleFilter } from '../store/filters.ts';
import { preferences } from '../store/preferences.ts';
import type { Sql } from '../store/sql.ts';
import type { Store } from '../store/store.ts';
import { ui } from './ui.ts';

/** A Gmail client for one of the person's mailboxes, with the sign-in kept in their database. */
export async function gmailClient(config: Config, db: Sql, email: string) {
  const token = await (await credentials(db, 'gmail', config.keys)).read(email);
  if (token === null) throw new Error(`sift has no access to ${email}. Sign in to the dashboard with that account.`);
  return clientFor(loadClientSecrets(config), token);
}

const mailboxFor = async (config: Config, db: Sql, email: string) => createGmailMailbox(await gmailClient(config, db, email));

/** One person's model providers, signed in with what is kept in their database. */
const modelsFor = async (config: Config, db: Sql) => openModels(await credentials(db, 'model', config.keys));

/**
 * The model tier of the person whose database `db` is, from their own choice, sign-in and guidelines.
 * Null when they have chosen no model. Throws, with what to do, when they have chosen one they cannot reach.
 */
export async function openModelTier(config: Config, db: Sql) {
  const { model: spec, guidelines } = await preferences(db);
  if (!spec) return null;
  const models = await modelsFor(config, db);
  const model = resolveModel(models, spec);
  if (!(await models.getAuth(model))) throw new Error(`Not signed in to ${model.provider}. Sign in under Settings in the dashboard.`);
  return { spec, guidelines, judge: createJudge(models, model, (message) => ui.fail(`Model call failed: ${message}`)) };
}

/** A stable id for this installation, created on first use. ChatGPT registers the device under it. */
function deviceId(config: Config): string {
  if (existsSync(config.deviceIdPath)) return readFileSync(config.deviceIdPath, 'utf8').trim();
  const id = randomUUID();
  writeFileSync(config.deviceIdPath, id, { mode: 0o600 });
  return id;
}

/** What the dashboard may ask this process to do. See `Controls`. */
export async function buildControls(config: Config, store: Store, live: { wake?: Wake; activity: Activity }): Promise<Controls> {
  const current = () => loadConfig().settings;
  const everyone = async () => await Promise.all((await listUsers(store.central)).map((u) => store.user(u.id)));
  for (const db of await everyone()) await interruptEvals(db);
  // By person: suggestions being judged again, and a ChatGPT sign-in waiting on them.
  const rejudging = new Set<number>();
  const pending = new Map<number, NonNullable<ModelSignIns['pending']>>();
  return {
    settings: () => {
      const s = current();
      return { act: s.act, interval: s.interval, fewShot: s.fewShot, examplesKeepDays: s.examplesKeepDays ?? null };
    },
    saveSettings: (change) => {
      const { examplesKeepDays: _kept, ...rest } = current();
      const keepDays = change.examplesKeepDays === undefined ? current().examplesKeepDays : (change.examplesKeepDays ?? undefined);
      saveSettings(config, {
        ...rest,
        ...(change.act === undefined ? {} : { act: change.act }),
        ...(change.interval === undefined ? {} : { interval: change.interval }),
        ...(change.fewShot === undefined ? {} : { fewShot: change.fewShot }),
        ...(keepDays ? { examplesKeepDays: keepDays } : {}),
      });
      live.wake?.now();
    },
    models: async (db) => {
      const available = (await (await modelsFor(config, db)).getAvailable()).map((m) => ({ provider: m.provider, id: m.id }));
      const providers = [...new Set(available.map((m) => m.provider))];
      const recommended = providers
        .map((provider) =>
          recommendModel(
            provider,
            available.filter((m) => m.provider === provider).map((m) => m.id),
          ),
        )
        .flatMap((id, index) => (id ? [`${providers[index]}/${id}`] : []))[0];
      return { models: available.map((m) => `${m.provider}/${m.id}`), recommended: recommended ?? null };
    },
    modelSignIns: async (db) => {
      const waiting = pending.get(await personOf(db));
      return {
        choices: MODEL_CHOICES.map((c) => ({ ...c })),
        signedIn: await (await credentials(db, 'model', config.keys)).keys(),
        pending: waiting && 'expiresAt' in waiting && waiting.expiresAt < Date.now() ? { error: 'That code expired. Start again.' } : (waiting ?? null),
      };
    },
    signInChatGPT: async (db) => {
      const person = await personOf(db);
      const started = await startChatGPTSignIn(await modelsFor(config, db), deviceId(config));
      const shown = { code: started.code, url: started.url, expiresAt: started.expiresAt };
      pending.set(person, shown);
      started.done.then(
        () => {
          if (pending.get(person) === shown) pending.delete(person);
          live.wake?.now();
        },
        (error: unknown) => {
          if (pending.get(person) === shown) pending.set(person, { error: error instanceof Error ? error.message : String(error) });
        },
      );
      return shown;
    },
    saveModelKey: async (db, provider, key) => {
      if (!MODEL_CHOICES.some((c) => c.provider === provider && c.how === 'key')) throw new Error('That provider does not take an API key.');
      await saveApiKey(await credentials(db, 'model', config.keys), provider, key);
      live.wake?.now();
    },
    signOutModel: async (db, provider) => {
      await (await credentials(db, 'model', config.keys)).remove(provider);
      pending.delete(await personOf(db));
    },
    rejudge: async (db, accountId) => {
      const person = await personOf(db);
      const account = (await listAccounts(db)).find((a) => a.id === accountId);
      const since = (await preferences(db)).guidelinesChangedAt;
      const tier = await openModelTier(config, db);
      if (!tier) throw new Error('Choose a model first.');
      if (!account || since === null) return { started: 0, remaining: 0 };
      if (rejudging.has(person)) throw new Error('Suggestions are already being judged again. Wait for that to finish.');
      const client = await gmailClient(config, db, account.email);
      const model = {
        judge: tier.judge,
        guidelines: tier.guidelines,
        fewShot: current().fewShot,
        sources: { api: createGmailApi(client), mailbox: createGmailMailbox(client) },
      };
      const { started, remaining, done } = await rejudgeWaiting({ db, mailbox: null, model }, account, since);
      rejudging.add(person);
      void done.finally(() => rejudging.delete(person));
      return { started, remaining };
    },
    undo: async (db, actionId) => {
      const action = await getAction(db, actionId);
      if (!action) throw new Error(`There is no change #${actionId}.`);
      const outcome = await undo({ db, mailbox: await mailboxFor(config, db, action.accountId) }, actionId);
      if (outcome.status === 'done') return 'Reversed.';
      if (outcome.status === 'skipped') return 'It had already been put back by hand.';
      throw new Error(outcome.reason);
    },
    backfill: async (days) => {
      let added = 0;
      for (const db of await everyone())
        for (const account of await listAccounts(db))
          added += await backfill(db, createGmailApi(await gmailClient(config, db, account.email)), account.id, days);
      return added;
    },
    putBack: async (db, accountId, messageId) => {
      const last = await lastStandingChange(db, accountId, messageId);
      if (last) await undo({ db, mailbox: await mailboxFor(config, db, accountId) }, last.id);
      // The corrected decision is waiting to be carried out; do it now, not at the next interval.
      live.wake?.now();
      return last !== null;
    },
    startEval: async (db, request) => {
      const tier = await openModelTier(config, db);
      if (!tier) throw new Error('Choose a model first.');
      return (await startEval({ db, judge: tier.judge, model: tier.spec, guidelines: tier.guidelines }, request)).id;
    },
    ruleFilter: async (db, ruleId, on) => {
      const rule = await getRuleFilter(db, ruleId);
      if (!rule) throw new Error('That rule no longer exists.');
      const deps = { db, mailbox: await mailboxFor(config, db, rule.accountId) };
      if (on) await writeRuleFilter(deps, ruleId);
      else await removeRuleFilter(deps, ruleId);
    },
    checkNow: () => live.wake?.now(),
    activity: () => live.activity,
  };
}
