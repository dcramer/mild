import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { loadConfig, saveKeyFile, saveSetting } from '../../config.ts';
import { hasClientSecrets, installClient } from '../../gmail/auth.ts';
import { connectedAddresses } from '../../store/accounts.ts';
import { loadKeyring } from '../../secrets.ts';
import { type Store, openStore } from '../../store/store.ts';
import { type SetupState, runInit } from '../init.ts';
import { tailscaleName } from '../network.ts';
import { ui } from '../ui.ts';
import { checkSecrets } from '../secrets-check.ts';

export async function init(): Promise<void> {
  const config = loadConfig();
  const withStore = async <T>(work: (store: Store) => Promise<T>): Promise<T> => {
    const store = await openStore(config);
    try {
      return await work(store);
    } finally {
      await store.close();
    }
  };
  // Started away from the .env that holds the key, init would otherwise make a second one.
  await withStore((store) => checkSecrets(config, store, false));
  await runInit({
    config,
    ui,
    saveSetting: (variable, value) => saveSetting(config, variable, value),
    saveKey: (key) => {
      const path = saveKeyFile(process.cwd(), key);
      process.env['MILD_KEY'] = key;
      // In place: the model credential store already holds this keyring.
      Object.assign(config.keys, loadKeyring());
      return path;
    },
    hasGoogleClient: () => hasClientSecrets(config),
    setupState: () => (existsSync(config.setupStatePath) ? (JSON.parse(readFileSync(config.setupStatePath, 'utf8')) as SetupState) : { googleTasks: 0 }),
    saveSetupState: (state) => writeFileSync(config.setupStatePath, JSON.stringify(state), { mode: 0o600 }),
    installGoogleClient: (json) => installClient(config, json),
    connectedAccounts: () => withStore((store) => connectedAddresses(store.central)),
    tailscaleName,
    enableTailscaleServe: async (servePort) => {
      let out: string;
      try {
        out = (await promisify(execFile)('tailscale', ['serve', '--bg', String(servePort)], { timeout: 20_000 })).stdout;
      } catch (error) {
        const detail = (error as { stderr?: string }).stderr?.trim().split('\n').at(-1);
        throw new Error(detail || 'tailscale serve did not start.', { cause: error });
      }
      // Tailscale exits 0 when serve is switched off for the tailnet, printing where to switch it on.
      if (/not enabled/i.test(out)) {
        const link = /https:\/\/\S+/.exec(out)?.[0];
        throw new Error(`Serve is off for your tailnet.${link ? ` Turn it on at ${link}` : ''}`);
      }
    },
  });
}
