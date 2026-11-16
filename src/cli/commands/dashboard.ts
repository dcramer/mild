import { parseArgs } from 'node:util';
import { loadConfig } from '../../config.ts';
import { openDb } from '../../store/db.ts';
import { ui } from '../ui.ts';
import { buildControls } from '../controls.ts';
import { checkSecrets } from '../secrets-check.ts';
import { serveDashboard, portOption } from '../serve.ts';

export async function dashboard(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const port = portOption(values.port);
  const config = loadConfig();
  const secrets = checkSecrets(config, true);
  const db = await openDb(config.dbPath);
  ui.heading('dashboard');
  secrets();
  const controls = await buildControls(config, db, { activity: { sorting: false, lastPassAt: null, problems: [], expired: [] } });
  const stop = await serveDashboard(config, db, { controls, ...(port === undefined ? {} : { port }), ...(values.host ? { host: values.host } : {}) });
  ui.info('Only the dashboard is running. `sift run` also sorts mail.');
  ui.blank();
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  stop();
  db.close();
}
