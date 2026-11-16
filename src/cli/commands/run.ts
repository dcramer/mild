import { parseArgs } from 'node:util';
import { unsubscribe } from '../../actions/unsubscribe.ts';
import { loadConfig } from '../../config.ts';
import { localJobs } from '../../daemon/jobs.ts';
import { type RunOptions, runEveryone, runJob, runLoop } from '../../daemon/run.ts';
import { hasClientSecrets } from '../../gmail/auth.ts';
import { type Account, connectedAddresses, listAccounts, listUsers, personOf } from '../../store/accounts.ts';
import { preferences } from '../../store/preferences.ts';
import { openStore } from '../../store/store.ts';
import { openEphemeral } from '../../ephemeral/open.ts';
import type { Sql } from '../../store/sql.ts';
import { paint, ui } from '../ui.ts';
import { buildControls, gmailFor, openModelTier } from '../controls.ts';
import { checkChatGPT } from '../chatgpt.ts';
import { credentials } from '../../store/credentials.ts';
import { checkSecrets } from '../secrets-check.ts';
import { serveDashboard, portOption } from '../serve.ts';

export async function run(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      once: { type: 'boolean', default: false },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-dashboard': { type: 'boolean', default: false },
      // Set by `sift dev`.
      dev: { type: 'boolean', default: false },
    },
  });
  const config = loadConfig();
  const store = await openStore(config);
  if (store.warning) ui.warn(store.warning);
  const ephemeral = await openEphemeral(config.settings.redisUrl);
  try {
    const secrets = await checkSecrets(config, store, true);
    const log = (line: string) => ui.plain(`${paint.dim(new Date().toLocaleTimeString(undefined, { hour12: false }))}  ${line}`);

    // Why each person's model could not be reached, so it is said once and not on every pass.
    const unreachable = new Map<number, string>();
    // Whether each person had sift on at their last pass, to say when they switch.
    const active = new Map<number, boolean>();
    const announce = async (person: number) => {
      const accounts = await listAccounts(await store.user(person));
      // Deleted since.
      if (accounts.length === 0) {
        unreachable.delete(person);
        active.delete(person);
        return;
      }
      const on = (await preferences(await store.user(person))).active;
      if (active.has(person) && active.get(person) !== on) log(`${accounts.map((a) => a.email).join(', ')}: now ${on ? 'on' : 'off'}`);
      active.set(person, on);
    };
    // Each person's own model, from their choice and sign-in, read on every pass.
    const model = async (db: Sql) => {
      const person = await personOf(db);
      try {
        const tier = await openModelTier(config, db);
        unreachable.delete(person);
        return tier && { judge: tier.judge, model: tier.spec };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (unreachable.get(person) !== message) ui.fail(`${(await listAccounts(db)).map((a) => a.email).join(', ')}: ${message}`);
        unreachable.set(person, message);
        return null;
      }
    };
    const jobs = localJobs(async (job, until) => {
      try {
        await runJob(store, job, options, until);
        if (job.kind === 'pass') await announce(job.person);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(job.kind === 'pass' ? `${job.account}: pass failed, will retry: ${message}` : `Could not delete old records, will retry tomorrow: ${message}`);
      }
    });
    const options: RunOptions = {
      ephemeral,
      jobs,
      model,
      unsubscribe: (db: Sql, accountId: string, messageId: string) => unsubscribe({ db }, accountId, messageId),
      connect: async (db: Sql, account: Account) => {
        const { api, mailbox } = await gmailFor(config, ephemeral, db, account.email);
        return { api, mailbox };
      },
      checkChatGPT: async (db: Sql) => await checkChatGPT(ephemeral, await personOf(db), await credentials(db, 'model', config.keys)),
      log,
    };

    for (const user of await listUsers(store.central)) await announce(user.id);
    const people = active.size;
    const on = [...active.values()].filter(Boolean).length;
    ui.heading(on === 0 ? 'off' : on === people ? 'on' : `on for ${on} of ${people}`);
    secrets();
    if (!hasClientSecrets(config)) ui.warn(`No Google client yet. Run ${paint.cmd('sift init')}.`);
    else if ((await connectedAddresses(store.central)).length === 0) ui.warn('No Gmail account yet. Open the dashboard and sign in with Google.');
    else if (on === 0) ui.info('Gmail is not changed while sift is off. Each person turns it on in the dashboard, under Settings.');

    if (values.once) {
      ui.blank();
      const results = await runEveryone(store, options);
      if (results.some((r) => r.error)) process.exitCode = 1;
      return;
    }

    // One process keeps sift online: the same one that classifies mail serves the dashboard.
    const port = portOption(values.port);
    const stopDashboard = values['no-dashboard']
      ? () => {}
      : await serveDashboard(config, store, {
          controls: await buildControls(config, store, { ephemeral, jobs, running: true }),
          ...(values.dev ? { dev: true } : {}),
          ...(port === undefined ? {} : { port }),
          ...(values.host ? { host: values.host } : {}),
        });
    ui.blank();
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    try {
      await runLoop(store, options, { signal: stop.signal });
    } finally {
      await jobs.stop();
      stopDashboard();
    }
  } finally {
    await ephemeral.close();
    await store.close();
  }
}
