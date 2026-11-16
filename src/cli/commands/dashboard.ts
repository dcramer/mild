import { parseArgs } from 'node:util';
import { loadConfig } from '../../config.ts';
import { openEphemeral } from '../../ephemeral/open.ts';
import { openStore } from '../../store/store.ts';
import { ui } from '../ui.ts';
import { createSift } from '../../app/sift.ts';
import { checkSecrets } from '../secrets-check.ts';
import { nodeHost, portOption, serveDashboard } from '../host.ts';

export async function dashboard(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const config = loadConfig();
  const port = portOption(values.port) ?? config.settings.dashboardPort;
  const store = await openStore(config);
  if (store.warning) ui.warn(store.warning);
  const secrets = await checkSecrets(config, store, true);
  ui.heading('dashboard');
  secrets();
  const ephemeral = await openEphemeral(config.settings.redisUrl);
  const sift = await createSift(nodeHost(config, store, ephemeral, port, (line) => ui.plain(line)));
  const stop = await serveDashboard(config, sift, { port, ...(values.host ? { host: values.host } : {}) });
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
