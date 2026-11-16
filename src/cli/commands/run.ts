import { parseArgs } from 'node:util';
import { unsubscribe } from '../../actions/unsubscribe.ts';
import { loadConfig } from '../../config.ts';
import type { Activity } from '../../dashboard/controls.ts';
import { type PassResult, createWake, runEveryone, runLoop } from '../../daemon/run.ts';
import { createGmailApi } from '../../gmail/api.ts';
import { hasClientSecrets } from '../../gmail/auth.ts';
import { createGmailMailbox } from '../../gmail/mailbox.ts';
import { type Account, connectedAddresses, listAccounts, listUsers, personOf } from '../../store/accounts.ts';
import { preferences } from '../../store/preferences.ts';
import { openStore } from '../../store/store.ts';
import type { Sql } from '../../store/sql.ts';
import { paint, ui } from '../ui.ts';
import { buildControls, gmailClient, openModelTier } from '../controls.ts';
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
  try {
    const secrets = await checkSecrets(config, store, true);
    const log = (line: string) => ui.plain(`${paint.dim(new Date().toLocaleTimeString(undefined, { hour12: false }))}  ${line}`);

    // Why each person's model could not be reached, so it is said once and not on every pass.
    const unreachable = new Map<number, string>();
    // Whether each person had sift on at the last pass, to say when they switch.
    const active = new Map<number, boolean>();
    const announce = async () => {
      for (const user of await listUsers(store.central)) {
        const db = await store.user(user.id);
        const on = (await preferences(db)).active;
        if (active.has(user.id) && active.get(user.id) !== on) log(`${(await listAccounts(db)).map((a) => a.email).join(', ')}: now ${on ? 'on' : 'off'}`);
        active.set(user.id, on);
      }
    };
    const next = async () => {
      await announce();
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
      return {
        model,
        unsubscribe: (db: Sql, accountId: string, messageId: string) => unsubscribe({ db }, accountId, messageId),
        connect: async (db: Sql, account: Account) => {
          const client = await gmailClient(config, db, account.email);
          return { api: createGmailApi(client), mailbox: createGmailMailbox(client) };
        },
        log,
      };
    };

    const first = await next();
    const people = active.size;
    const on = [...active.values()].filter(Boolean).length;
    ui.heading(on === 0 ? 'off' : on === people ? 'on' : `on for ${on} of ${people}`);
    secrets();
    if (!hasClientSecrets(config)) ui.warn(`No Google client yet. Run ${paint.cmd('sift init')}.`);
    else if ((await connectedAddresses(store.central)).length === 0) ui.warn('No Gmail account yet. Open the dashboard and sign in with Google.');
    else if (on === 0) ui.info('Gmail is not changed while sift is off. Each person turns it on in the dashboard, under Settings.');

    if (values.once) {
      ui.blank();
      const results = await runEveryone(store, first);
      if (results.some((r) => r.error)) process.exitCode = 1;
      return;
    }

    // One process keeps sift online: the same one that sorts mail serves the dashboard.
    const wake = createWake();
    const activity: Activity = { running: true, lastPassAt: null, problems: [], expired: [] };
    const port = portOption(values.port);
    const stopDashboard = values['no-dashboard']
      ? () => {}
      : await serveDashboard(config, store, {
          controls: await buildControls(config, store, { wake, activity }),
          ...(values.dev ? { dev: true } : {}),
          ...(port === undefined ? {} : { port }),
          ...(values.host ? { host: values.host } : {}),
        });
    ui.blank();
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    try {
      await runLoop(store, next, {
        signal: stop.signal,
        wake,
        onPass: (results: PassResult[]) => {
          activity.lastPassAt = Date.now();
          activity.problems = results.flatMap((r) => (r.error ? [`${r.email}: ${r.error}`] : []));
          activity.expired = results.filter((r) => r.expired).map((r) => r.email);
        },
      });
    } finally {
      stopDashboard();
    }
  } finally {
    await store.close();
  }
}
