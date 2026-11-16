import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { loadConfig, saveKeyFile, saveSettings } from '../../config.ts';
import { hasClientSecrets, installClient, loadClientSecrets } from '../../gmail/auth.ts';
import { login, openModels } from '../../model/models.ts';
import { listAccounts } from '../../store/accounts.ts';
import { loadKeyring } from '../../secrets.ts';
import { openDb } from '../../store/db.ts';
import { type SetupState, runInit } from '../init.ts';
import { tailscaleName } from '../network.ts';
import { ui } from '../ui.ts';
import { checkSecrets } from '../secrets-check.ts';

export async function init(): Promise<void> {
  const config = loadConfig();
  // Started away from the .env that holds the key, init would otherwise make a second one.
  checkSecrets(config, false);
  const models = openModels(config);
  const withDb = <T>(work: (db: ReturnType<typeof openDb>) => T): T => {
    const db = openDb(config.dbPath);
    try {
      return work(db);
    } finally {
      db.close();
    }
  };
  await runInit({
    config,
    ui,
    saveSettings: (settings) => saveSettings(config, settings),
    saveKey: (key) => {
      const path = saveKeyFile(process.cwd(), key);
      process.env['SIFT_KEY'] = key;
      // In place: the model credential store already holds this keyring.
      Object.assign(config.keys, loadKeyring());
      return path;
    },
    hasGoogleClient: () => hasClientSecrets(config),
    // A home set up before progress was recorded has a client and no state file: treat it as finished.
    setupState: () =>
      existsSync(config.setupStatePath)
        ? (JSON.parse(readFileSync(config.setupStatePath, 'utf8')) as SetupState)
        : hasClientSecrets(config)
          ? { googleTasks: 99, access: 'publish' }
          : { googleTasks: 0 },
    saveSetupState: (state) => writeFileSync(config.setupStatePath, JSON.stringify(state), { mode: 0o600 }),
    installGoogleClient: (json) => installClient(config, json),
    connectedAccounts: () => withDb((db) => listAccounts(db).map((a) => a.email)),
    loginModel: (choice) => login(models, config, choice.provider, choice.type, ui),
    availableModels: async (provider) => (await models.getAvailable(provider)).map((m) => m.id),
    googleClientKind: () => (hasClientSecrets(config) ? loadClientSecrets(config).kind : null),
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
