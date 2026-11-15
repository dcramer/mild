import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type InitDeps, runInit } from '../src/cli/init.ts';
import { DEFAULT_SETTINGS, loadConfig, parseSettings, renderSettings, resolveHome, saveSettings } from '../src/config.ts';
import { installClientFile, loadClientSecrets } from '../src/gmail/auth.ts';
import { DEFAULT_CATEGORIES } from '../src/store/categories.ts';

const freshHome = () => mkdtempSync(join(tmpdir(), 'sift-home-'));

/** A wizard run with scripted answers. `state` is what already exists; the fakes change it as the real steps would. */
function wizard(answers: string[], state: { client?: boolean; accounts?: string[]; models?: string[]; loginFails?: boolean } = {}) {
  const config = loadConfig({ SIFT_HOME: freshHome() });
  const said: string[] = [];
  const asked: string[] = [];
  const calls: string[] = [];
  const world = { client: state.client ?? false, accounts: [...(state.accounts ?? [])] };
  const deps: InitDeps = {
    config,
    terminal: {
      ask: async (question) => {
        asked.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`unexpected question: ${question}`);
        return answer;
      },
      say: (line) => said.push(line),
    },
    saveSettings: (settings) => saveSettings(config, settings),
    hasGoogleClient: () => world.client,
    installGoogleClient: (path) => {
      calls.push(`install ${path}`);
      if (path.includes('wrong')) throw new Error('not a Desktop OAuth client file');
      world.client = true;
    },
    connectedAccounts: () => world.accounts,
    connectGmail: async () => {
      calls.push('gmail');
      world.accounts.push('me@example.org');
      return 'me@example.org';
    },
    loginModel: async (choice) => {
      calls.push(`login ${choice.provider} ${choice.type}`);
      if (state.loginFails) throw new Error('cancelled');
    },
    availableModels: async () => state.models ?? ['small', 'large'],
    categories: () => [...DEFAULT_CATEGORIES],
  };
  return { deps, config, said, asked, calls, text: () => said.join('\n') };
}

describe('sift init', () => {
  it('walks a new user through every step and writes the files', async () => {
    const w = wizard(['/downloads/client.json', '1', '1']);
    await runInit(w.deps);

    expect(w.calls).toEqual(['install /downloads/client.json', 'gmail', 'login openai-codex oauth']);
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings).toEqual({ ...DEFAULT_SETTINGS, model: 'openai-codex/small' });
    expect(readFileSync(w.config.guidelinesPath, 'utf8')).toContain('Guidelines for sift');
    expect(w.text()).toContain('connected me@example.org');
    expect(w.text()).toContain('Newsletters');
    expect(w.text()).toContain('Ready. sift starts by observing');
  });

  it('asks nothing when everything is already set up', async () => {
    const w = wizard([], { client: true, accounts: ['me@example.org'] });
    saveSettings(w.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(w.deps);
    expect(w.asked).toEqual([]);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('using openai/x');
    expect(w.text()).toContain('Ready.');
  });

  it('lets every step be skipped and says what is left', async () => {
    const w = wizard(['', '4']);
    await runInit(w.deps);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('skipped: this needs the Google client');
    expect(w.text()).toContain('Not finished: the Google client and a Gmail account');
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings.model).toBeUndefined();
    expect(existsSync(w.config.settingsPath)).toBe(true);
  });

  it('asks again after a wrong client file and a bad menu answer', async () => {
    const w = wizard(['/downloads/wrong.json', '/downloads/client.json', 'nine', '2', '2']);
    await runInit(w.deps);
    expect(w.calls).toEqual(['install /downloads/wrong.json', 'install /downloads/client.json', 'gmail', 'login openai api_key']);
    expect(w.text()).toContain('That did not work: not a Desktop OAuth client file');
    expect(w.text()).toContain('Enter a number from 1 to 4.');
    expect(w.config.settings.model).toBe('openai/large');
  });

  it('keeps going when model sign-in fails, and takes a typed id when no models are listed', async () => {
    const failed = wizard(['1'], { client: true, accounts: ['me@example.org'], loginFails: true });
    await runInit(failed.deps);
    expect(failed.text()).toContain('Sign-in did not finish: cancelled');
    expect(failed.config.settings.model).toBeUndefined();
    expect(failed.text()).toContain('Ready.');

    const typed = wizard(['3', 'claude-test'], { client: true, accounts: ['me@example.org'], models: [] });
    await runInit(typed.deps);
    expect(typed.config.settings.model).toBe('anthropic/claude-test');
  });
});

describe('settings', () => {
  it('defaults to ~/.config/sift and honours XDG_CONFIG_HOME and SIFT_HOME', () => {
    expect(resolveHome({ HOME: '/home/u' })).toMatch(/\/\.config\/sift$/);
    expect(resolveHome({ XDG_CONFIG_HOME: '/x' })).toBe('/x/sift');
    expect(resolveHome({ SIFT_HOME: '/data', XDG_CONFIG_HOME: '/x' })).toBe('/data');
  });

  it('keeps everything in the home directory and needs no environment variables', () => {
    const home = freshHome();
    const config = loadConfig({ SIFT_HOME: home });
    for (const path of [
      config.settingsPath,
      config.guidelinesPath,
      config.dbPath,
      config.googleClientPath,
      config.googleTokenDir,
      config.modelAuthPath,
      config.deviceIdPath,
    ]) {
      expect(path.startsWith(`${home}/`)).toBe(true);
    }
    expect(config.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through sift.toml', () => {
    const settings = { model: 'openai-codex/some-model', act: true, interval: 120, dashboardPort: 9000 };
    expect(parseSettings(renderSettings(settings))).toEqual(settings);
    expect(parseSettings(renderSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects typos and wrong types with the setting named', () => {
    expect(() => parseSettings('modle = "a/b"')).toThrow('unknown setting modle');
    expect(() => parseSettings('act = "yes"')).toThrow('act must be true or false');
    expect(() => parseSettings('model = "no-slash"')).toThrow('provider/model-id');
    expect(() => parseSettings('interval = 1')).toThrow('at least 5');
    expect(() => parseSettings('[dashboard]\nhost = "x"')).toThrow('unknown setting dashboard.host');
    expect(() => parseSettings('act = ')).toThrow('not valid TOML');
  });

  it('installs a Google client file only if it is a Desktop client', () => {
    const config = loadConfig({ SIFT_HOME: freshHome() });
    const good = join(freshHome(), 'client.json');
    const web = join(freshHome(), 'web.json');
    writeFileSync(good, JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } }));
    writeFileSync(web, JSON.stringify({ web: { client_id: 'id', client_secret: 'secret' } }));

    expect(() => installClientFile(config, web)).toThrow('not a Desktop OAuth client file');
    expect(() => loadClientSecrets(config, {})).toThrow('Run `sift init`');
    installClientFile(config, good);
    expect(loadClientSecrets(config, {})).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });
});
