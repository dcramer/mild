import { existsSync } from 'node:fs';
import { loadConfig } from '../../config.ts';
import { hasClientSecrets } from '../../gmail/auth.ts';
import { connectedAddresses, listUsers } from '../../store/accounts.ts';
import { openStore } from '../../store/store.ts';
import { paint, ui } from '../ui.ts';
import { checkSecrets } from '../secrets-check.ts';
import { signInAddresses } from '../serve.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export async function status(): Promise<void> {
  const config = loadConfig();
  const secrets = checkSecrets(config, false);
  const store = await openStore(config);
  const accounts = await connectedAddresses(store.central);
  const people = await Promise.all((await listUsers(store.central)).map((u) => store.user(u.id)));
  const count = async (table: string, where = '') => {
    let n = 0;
    for (const db of people) n += (await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table} ${where}`))!.n;
    return n;
  };
  const { settings } = config;
  const ready = hasClientSecrets(config) && accounts.length > 0;

  ui.heading('status', paint.path(config.home));
  ui.fields([
    ['Gmail', accounts.length > 0 ? accounts.join(', ') : paint.dim(hasClientSecrets(config) ? 'not connected' : 'not set up')],
    ['Model', settings.model ?? paint.dim('none')],
    ['Mode', `${settings.act ? 'acting on decisions' : 'observing only'}${paint.dim(` · every ${settings.interval}s`)}`],
    ['Guidance', existsSync(config.guidelinesPath) ? paint.path(config.guidelinesPath) : paint.dim('none written')],
    ['Dashboard', signInAddresses(settings.dashboardPort).join(paint.dim('  or  '))],
  ]);
  ui.blank();
  const troubled = await count('actions', `WHERE status IN ('failed', 'unknown', 'pending')`);
  ui.fields([
    [
      'Recorded',
      `${plural(await count('messages'), 'message')} · ${plural(await count('decisions'), 'decision')} · ${plural(await count('actions'), 'change')}`,
    ],
    ['Rules', plural(await count('rules'), 'rule')],
    ...(troubled > 0 ? [['Check', paint.bad(`${plural(troubled, 'change')} failed or unconfirmed; see Changes in the dashboard`)] as const] : []),
  ]);
  ui.blank();
  if (!ready) ui.warn(`Setup is not finished. Run ${paint.cmd('sift init')}.`);
  secrets();
  if (!ready || !config.keys.current) ui.blank();
  await store.close();
}
