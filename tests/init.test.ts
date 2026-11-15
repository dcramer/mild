import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type InitDeps, runInit } from '../src/cli/init.ts';
import type { Ui } from '../src/cli/ui.ts';
import { DEFAULT_SETTINGS, loadConfig, parseSettings, renderSettings, resolveHome, saveSettings } from '../src/config.ts';
import { installClient, loadClientSecrets } from '../src/gmail/auth.ts';
import { DEFAULT_CATEGORIES } from '../src/store/categories.ts';

const freshHome = () => mkdtempSync(join(tmpdir(), 'sift-home-'));

/**
 * A wizard run with scripted answers. `state` is what already exists; the fakes change it as the real
 * steps would. Answers are consumed in order: a string for a text or paste prompt, a number for the
 * index chosen in a menu, and 'skip' or 'done' for a pause.
 */
function wizard(answers: (string | number)[], state: { client?: boolean; accounts?: string[]; models?: string[]; loginFails?: boolean } = {}) {
  const config = loadConfig({ SIFT_HOME: freshHome() });
  const said: string[] = [];
  const asked: string[] = [];
  const calls: string[] = [];
  const world = { client: state.client ?? false, accounts: [...(state.accounts ?? [])] };
  const next = (question: string) => {
    asked.push(question);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`unexpected question: ${question}`);
    return answer;
  };
  const record = (line: string) => void said.push(line);
  const ui: Ui = {
    heading: (title, detail) => record(`# ${title} ${detail ?? ''}`),
    step: (n, total, title) => record(`${n}/${total} ${title}`),
    ok: (text) => record(`ok: ${text}`),
    skip: (text) => record(`skip: ${text}`),
    warn: (text) => record(`warn: ${text}`),
    fail: (text) => record(`fail: ${text}`),
    info: record,
    plain: record,
    blank: () => {},
    link: (url) => record(`link: ${url}`),
    fields: (rows) => rows.forEach(([label, value]) => record(`${label.trim()}: ${value}`)),
    table: (_headers, rows) => rows.forEach((row) => record(row.join(' | '))),
    select: async (question, options) => {
      const index = next(question);
      const option = options[index as number];
      if (typeof index !== 'number' || !option) throw new Error(`bad scripted choice for: ${question}`);
      return option.value;
    },
    text: async (question) => String(next(question)),
    pasteJson: async (question) => String(next(question)),
    pause: async () => next('pause') !== 'skip',
    mark: () => {},
    collapse: (summary) => record(`ok: ${summary}`),
    spin: (_label, work) => work(),
  };
  const deps: InitDeps = {
    config,
    ui,
    saveSettings: (settings) => saveSettings(config, settings),
    hasGoogleClient: () => world.client,
    installGoogleClient: (json) => {
      calls.push(`install ${json}`);
      if (json.includes('web')) throw new Error('What you pasted is not a Desktop app client');
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

const TASKS = ['done', 'done', 'done', 'done', 'done', 'done'];
const CLIENT = '{"installed":{}}';

describe('sift init', () => {
  it('walks a new user through every step and writes the files', async () => {
    const w = wizard([...TASKS, CLIENT, 0, 0]);
    await runInit(w.deps);

    expect(w.calls).toEqual([`install ${CLIENT}`, 'gmail', 'login openai-codex oauth']);
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings).toEqual({ ...DEFAULT_SETTINGS, model: 'openai-codex/small' });
    expect(readFileSync(w.config.guidelinesPath, 'utf8')).toContain('Guidelines for sift');
    expect(w.text()).toContain('ok: Connected');
    expect(w.text()).toContain('Newsletters');
    expect(w.text()).toContain('Ready');
  });

  it('pauses after each Google task, with its link and the values to enter', async () => {
    const w = wizard([...TASKS, CLIENT, 3]);
    await runInit(w.deps);
    expect(w.asked.filter((q) => q === 'pause')).toHaveLength(6);
    const links = w.said.filter((line) => line.startsWith('link: '));
    expect(links).toEqual([
      'link: https://console.cloud.google.com/projectcreate',
      'link: https://console.cloud.google.com/apis/library/gmail.googleapis.com',
      'link: https://console.cloud.google.com/auth/overview',
      'link: https://console.cloud.google.com/auth/clients',
      'link: https://console.cloud.google.com/auth/scopes',
      'link: https://console.cloud.google.com/auth/audience',
    ]);
    expect(w.text()).toContain('Audience: External');
    expect(w.text()).toContain('Application type: Desktop app');
    expect(w.text()).toContain('Scopes: https://www.googleapis.com/auth/gmail.modify');
    expect(w.text()).toContain('https://www.googleapis.com/auth/gmail.settings.basic');
  });

  it('asks nothing when everything is already set up', async () => {
    const w = wizard([], { client: true, accounts: ['me@example.org'] });
    saveSettings(w.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(w.deps);
    expect(w.asked).toEqual([]);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('ok: Using');
    expect(w.text()).toContain('Ready');
  });

  it('lets the Google tasks be left part-way and says what is still needed', async () => {
    const w = wizard(['done', 'skip', 3]);
    await runInit(w.deps);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('skip: Stopped here');
    expect(w.text()).toContain('skip: Needs the Google client from step 1');
    expect(w.text()).toContain('warn: Still needed: the Google client and a Gmail account');
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings.model).toBeUndefined();
    expect(existsSync(w.config.settingsPath)).toBe(true);
  });

  it('asks again when the pasted client is the wrong kind', async () => {
    const w = wizard([...TASKS, '{"web":{}}', CLIENT, 1, 1]);
    await runInit(w.deps);
    expect(w.calls).toEqual(['install {"web":{}}', `install ${CLIENT}`, 'gmail', 'login openai api_key']);
    expect(w.text()).toContain('fail: What you pasted is not a Desktop app client');
    expect(w.config.settings.model).toBe('openai/large');
  });

  it('keeps going when model sign-in fails, and takes a typed id when no models are listed', async () => {
    const failed = wizard([0], { client: true, accounts: ['me@example.org'], loginFails: true });
    await runInit(failed.deps);
    expect(failed.text()).toContain('fail: Sign-in did not finish: cancelled');
    expect(failed.config.settings.model).toBeUndefined();
    expect(failed.text()).toContain('Ready');

    const typed = wizard([2, 'claude-test'], { client: true, accounts: ['me@example.org'], models: [] });
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

  it('installs a pasted Google client, or one given as a path, only if it is a Desktop client', () => {
    const config = loadConfig({ SIFT_HOME: freshHome() });
    const desktop = JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } }, null, 2);

    expect(() => installClient(config, JSON.stringify({ web: { client_id: 'id', client_secret: 'secret' } }))).toThrow('not a Desktop app client');
    expect(() => installClient(config, '{"installed": ')).toThrow('not valid JSON');
    expect(() => loadClientSecrets(config, {})).toThrow('Run `sift init`');

    installClient(config, `  ${desktop}\n`);
    expect(loadClientSecrets(config, {})).toEqual({ clientId: 'id', clientSecret: 'secret' });

    const other = loadConfig({ SIFT_HOME: freshHome() });
    const file = join(freshHome(), 'client.json');
    writeFileSync(file, desktop);
    installClient(other, file);
    expect(loadClientSecrets(other, {})).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });
});
