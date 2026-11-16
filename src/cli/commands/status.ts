import { existsSync } from 'node:fs';
import { loadConfig } from '../../config.ts';
import { hasClientSecrets } from '../../gmail/auth.ts';
import { listAccounts } from '../../store/accounts.ts';
import { openDb } from '../../store/db.ts';
import { paint, ui } from '../ui.ts';
import { checkSecrets } from '../secrets-check.ts';
import { signInAddresses } from '../serve.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function status(): void {
  const config = loadConfig();
  const secrets = checkSecrets(config, false);
  const db = openDb(config.dbPath);
  const accounts = listAccounts(db);
  const count = (table: string, where = '') => (db.prepare(`SELECT count(*) AS n FROM ${table} ${where}`).get() as { n: number }).n;
  const { settings } = config;
  const ready = hasClientSecrets(config) && accounts.length > 0;

  ui.heading('status', paint.path(config.home));
  ui.fields([
    ['Gmail', accounts.length > 0 ? accounts.map((a) => a.email).join(', ') : paint.dim(hasClientSecrets(config) ? 'not connected' : 'not set up')],
    ['Model', settings.model ?? paint.dim('none')],
    ['Mode', `${settings.act ? 'acting on decisions' : 'observing only'}${paint.dim(` · every ${settings.interval}s`)}`],
    ['Guidance', existsSync(config.guidelinesPath) ? paint.path(config.guidelinesPath) : paint.dim('none written')],
    ['Dashboard', signInAddresses(settings.dashboardPort).join(paint.dim('  or  '))],
  ]);
  ui.blank();
  const troubled = count('actions', `WHERE status IN ('failed', 'unknown', 'pending')`);
  ui.fields([
    ['Recorded', `${plural(count('messages'), 'message')} · ${plural(count('decisions'), 'decision')} · ${plural(count('actions'), 'change')}`],
    ['Rules', plural(count('rules'), 'rule')],
    ...(troubled > 0 ? [['Check', paint.bad(`${plural(troubled, 'change')} failed or unconfirmed; see Changes in the dashboard`)] as const] : []),
  ]);
  ui.blank();
  if (!ready) ui.warn(`Setup is not finished. Run ${paint.cmd('sift init')}.`);
  secrets();
  if (!ready || !config.keys.current) ui.blank();
  db.close();
}
