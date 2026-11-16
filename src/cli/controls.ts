import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { undo } from '../actions/executor.ts';
import { removeRuleFilter, writeRuleFilter } from '../actions/rule-filters.ts';
import { type Config, loadConfig, saveSettings } from '../config.ts';
import { backfill } from '../daemon/backfill.ts';
import type { Activity, Controls } from '../dashboard/controls.ts';
import { rejudgeWaiting } from '../daemon/rejudge.ts';
import type { Wake } from '../daemon/run.ts';
import { createGmailApi } from '../gmail/api.ts';
import { interruptEvals, startEval } from '../learn/evals.ts';
import { clientFor, loadClientSecrets } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { createJudge } from '../model/judge.ts';
import { openModels, resolveModel } from '../model/models.ts';
import { listAccounts } from '../store/accounts.ts';
import { getAction, lastStandingChange } from '../store/actions.ts';
import { type openDb } from '../store/db.ts';
import { ui } from './ui.ts';
import { getRuleFilter } from '../store/filters.ts';

const mailboxFor = (config: Config, email: string) => createGmailMailbox(clientFor(config, loadClientSecrets(config), email));

export async function openModelTier(config: Config, spec: string) {
  const models = openModels(config);
  const model = resolveModel(models, spec);
  if (!(await models.getAuth(model)))
    throw new Error(`Not signed in to ${model.provider}. Run \`sift init\` and choose Model, or set its API key in the environment.`);
  return {
    judge: createJudge(models, model, (message) => ui.fail(`Model call failed: ${message}`)),
    // Read on every pass, so edits to the file take effect without a restart.
    guidelines: () => (existsSync(config.guidelinesPath) ? readFileSync(config.guidelinesPath, 'utf8') : ''),
  };
}

/** What the dashboard may ask this process to do. See `Controls`. */
export function buildControls(config: Config, db: ReturnType<typeof openDb>, live: { wake?: Wake; activity: Activity }): Controls {
  const current = () => loadConfig().settings;
  interruptEvals(db);
  const guidelinesChangedAt = () => (existsSync(config.guidelinesPath) ? statSync(config.guidelinesPath).mtimeMs : null);
  let rejudging = false;
  return {
    settings: () => {
      const s = current();
      return { act: s.act, interval: s.interval, model: s.model ?? null, fewShot: s.fewShot, examplesKeepDays: s.examplesKeepDays ?? null };
    },
    saveSettings: (change) => {
      const { model: _old, examplesKeepDays: _kept, ...rest } = current();
      const model = change.model === undefined ? current().model : (change.model ?? undefined);
      const keepDays = change.examplesKeepDays === undefined ? current().examplesKeepDays : (change.examplesKeepDays ?? undefined);
      saveSettings(config, {
        ...rest,
        ...(change.act === undefined ? {} : { act: change.act }),
        ...(change.interval === undefined ? {} : { interval: change.interval }),
        ...(change.fewShot === undefined ? {} : { fewShot: change.fewShot }),
        ...(model ? { model } : {}),
        ...(keepDays ? { examplesKeepDays: keepDays } : {}),
      });
      live.wake?.now();
    },
    models: async () => (await openModels(config).getAvailable()).map((m) => `${m.provider}/${m.id}`),
    guidelines: () => (existsSync(config.guidelinesPath) ? readFileSync(config.guidelinesPath, 'utf8') : ''),
    saveGuidelines: (text) => {
      // Saving the same text must not make every waiting suggestion look out of date.
      if (existsSync(config.guidelinesPath) && readFileSync(config.guidelinesPath, 'utf8') === text) return;
      writeFileSync(config.guidelinesPath, text, { mode: 0o600 });
    },
    guidelinesChangedAt,
    rejudge: async (accountId) => {
      const spec = current().model;
      const account = listAccounts(db).find((a) => a.id === accountId);
      const since = guidelinesChangedAt();
      if (!spec) throw new Error('Choose a model first.');
      if (!account || since === null) return { started: 0, remaining: 0 };
      if (rejudging) throw new Error('Suggestions are already being judged again. Wait for that to finish.');
      const tier = await openModelTier(config, spec);
      const client = clientFor(config, loadClientSecrets(config), account.email);
      const model = {
        judge: tier.judge,
        guidelines: tier.guidelines(),
        fewShot: current().fewShot,
        sources: { api: createGmailApi(client), mailbox: createGmailMailbox(client) },
      };
      const { started, remaining, done } = rejudgeWaiting({ db, mailbox: null, model }, account, since);
      rejudging = true;
      void done.finally(() => (rejudging = false));
      return { started, remaining };
    },
    undo: async (actionId) => {
      const action = getAction(db, actionId);
      if (!action) throw new Error(`There is no change #${actionId}.`);
      const outcome = await undo({ db, mailbox: mailboxFor(config, action.accountId) }, actionId);
      if (outcome.status === 'done') return 'Reversed.';
      if (outcome.status === 'skipped') return 'It had already been put back by hand.';
      throw new Error(outcome.reason);
    },
    backfill: async (days) => {
      const secrets = loadClientSecrets(config);
      let added = 0;
      for (const account of listAccounts(db)) added += await backfill(db, createGmailApi(clientFor(config, secrets, account.email)), account.id, days);
      return added;
    },
    putBack: async (accountId, messageId) => {
      const last = lastStandingChange(db, accountId, messageId);
      if (last) await undo({ db, mailbox: mailboxFor(config, accountId) }, last.id);
      // The corrected decision is waiting to be carried out; do it now, not at the next interval.
      live.wake?.now();
      return last !== null;
    },
    startEval: async (request) => {
      const spec = current().model;
      if (!spec) throw new Error('Choose a model first.');
      const tier = await openModelTier(config, spec);
      return startEval({ db, judge: tier.judge, model: spec, guidelines: tier.guidelines() }, request).id;
    },
    ruleFilter: async (ruleId, on) => {
      const rule = getRuleFilter(db, ruleId);
      if (!rule) throw new Error('That rule no longer exists.');
      const deps = { db, mailbox: mailboxFor(config, rule.accountId) };
      if (on) await writeRuleFilter(deps, ruleId);
      else await removeRuleFilter(deps, ruleId);
    },
    checkNow: () => live.wake?.now(),
    activity: () => live.activity,
  };
}
