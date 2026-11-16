import { loadConfig } from '../../config.ts';
import { hasClientSecrets } from '../../gmail/auth.ts';
import { connectedAddresses, listUsers } from '../../store/accounts.ts';
import { DatabaseInUse } from '../../store/db.ts';
import { type SQL, actions, count, decisions, inArray, messages, rules } from '../../store/query.ts';
import { openStore } from '../../store/store.ts';
import { paint, ui } from '../ui.ts';
import { checkSecrets } from '../secrets-check.ts';
import { signInAddresses } from '../serve.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export async function status(): Promise<void> {
  const config = loadConfig();
  const store = await openStore(config).catch((error: unknown) => {
    if (error instanceof DatabaseInUse) return error;
    throw error;
  });
  // PGlite is one process's alone: while sift runs, what it has recorded is in its dashboard.
  if (store instanceof DatabaseInUse) {
    ui.heading('status', paint.path(config.home));
    ui.info(`sift is running (process ${store.pid}) with the database open. See the dashboard.`);
    ui.blank();
    return;
  }
  const secrets = await checkSecrets(config, store, false);
  const accounts = await connectedAddresses(store.central);
  const people = await Promise.all((await listUsers(store.central)).map((u) => store.user(u.id)));
  const total = async (table: typeof messages | typeof decisions | typeof actions | typeof rules, where?: SQL) => {
    let n = 0;
    for (const db of people) n += (await db.select({ n: count() }).from(table).where(where))[0]!.n;
    return n;
  };
  const { settings } = config;
  const ready = hasClientSecrets(config) && accounts.length > 0;

  ui.heading('status', paint.path(config.home));
  ui.fields([
    ['Gmail', accounts.length > 0 ? accounts.join(', ') : paint.dim(hasClientSecrets(config) ? 'not connected' : 'not set up')],
    ['Mode', `${settings.act ? 'acting on decisions' : 'observing only'}${paint.dim(` · every ${settings.interval}s`)}`],
    ['Dashboard', signInAddresses(settings.dashboardPort).join(paint.dim('  or  '))],
  ]);
  ui.blank();
  const troubled = await total(actions, inArray(actions.status, ['failed', 'unknown', 'pending']));
  ui.fields([
    ['Recorded', `${plural(await total(messages), 'message')} · ${plural(await total(decisions), 'decision')} · ${plural(await total(actions), 'change')}`],
    ['Rules', plural(await total(rules), 'rule')],
    ...(troubled > 0 ? [['Check', paint.bad(`${plural(troubled, 'change')} failed or unconfirmed; see Changes in the dashboard`)] as const] : []),
  ]);
  ui.blank();
  if (!ready) ui.warn(`Setup is not finished. Run ${paint.cmd('sift init')}.`);
  secrets();
  if (!ready || !config.keys.current) ui.blank();
  await store.close();
}
