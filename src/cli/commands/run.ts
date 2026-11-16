import { parseArgs } from 'node:util';
import { unsubscribe } from '../../actions/unsubscribe.ts';
import { loadConfig } from '../../config.ts';
import { LOCAL_TICK_MS, type RunOptions, runEveryone, runLoop, tick } from '../../daemon/run.ts';
import { hasClientSecrets } from '../../gmail/auth.ts';
import { type Account, connectedAddresses, listAccounts, listUsers, personOf } from '../../store/accounts.ts';
import { preferences } from '../../store/preferences.ts';
import { openStore } from '../../store/store.ts';
import { openEphemeral } from '../../ephemeral/open.ts';
import type { Sql } from '../../store/sql.ts';
import { paint, ui } from '../ui.ts';
import { buildControls, gmailFor, openModelTier } from '../controls.ts';
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
    // Each person's own model, from their choice and sign-in, read on every pass.
    const model = async (db: Sql) => {
      const person = await personOf(db);
      try {
        const tier = await openModelTier(config, ephemeral, db);
        unreachable.delete(person);
        return tier && { judge: tier.judge, model: tier.spec };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (unreachable.get(person) !== message) ui.fail(`${(await listAccounts(db)).map((a) => a.email).join(', ')}: ${message}`);
        unreachable.set(person, message);
        return null;
      }
    };
    const options: RunOptions = {
      ephemeral,
      model,
      unsubscribe: (db: Sql, accountId: string, messageId: string) => unsubscribe({ db }, accountId, messageId),
      connect: async (db: Sql, account: Account) => {
        const { api, mailbox } = await gmailFor(config, ephemeral, db, account.email);
        return { api, mailbox };
      },
      log,
    };

    const users = await listUsers(store.central);
    const people = users.length;
    let on = 0;
    for (const user of users) if ((await preferences(await store.user(user.id))).active) on++;
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
    const kicked = new Set<Promise<unknown>>();
    // What the dashboard starts (check now, a test run, older mail) runs now rather than at the next tick.
    const kick = (person?: number) => {
      const ticking: Promise<unknown> = tick(store, options, Date.now() + LOCAL_TICK_MS, person === undefined ? undefined : [person])
        .catch((error: unknown) => log(`Could not start: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => kicked.delete(ticking));
      kicked.add(ticking);
    };
    const port = portOption(values.port);
    const stopDashboard = values['no-dashboard']
      ? () => {}
      : await serveDashboard(config, store, {
          controls: await buildControls(config, store, { ephemeral, kick, running: true }),
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
      stopDashboard();
      await Promise.all(kicked);
    }
  } finally {
    await ephemeral.close();
    await store.close();
  }
}
