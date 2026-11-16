import { parseArgs } from 'node:util';
import { loadConfig } from '../../config.ts';
import { openEphemeral } from '../../ephemeral/open.ts';
import { openStore } from '../../store/store.ts';
import { ui } from '../ui.ts';
import { buildControls } from '../controls.ts';
import { checkSecrets } from '../secrets-check.ts';
import { serveDashboard, portOption } from '../serve.ts';

export async function dashboard(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const port = portOption(values.port);
  const config = loadConfig();
  const store = await openStore(config);
  if (store.warning) ui.warn(store.warning);
  const secrets = await checkSecrets(config, store, true);
  ui.heading('dashboard');
  secrets();
  const ephemeral = await openEphemeral(config.settings.redisUrl);
  const controls = await buildControls(config, store, { ephemeral, activity: { running: false, lastPassAt: null, problems: [], expired: [] } });
  const stop = await serveDashboard(config, store, { controls, ...(port === undefined ? {} : { port }), ...(values.host ? { host: values.host } : {}) });
  ui.info('Only the dashboard is running. `sift run` also reads and classifies mail.');
  ui.blank();
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  stop();
  await ephemeral.close();
  await store.close();
}
