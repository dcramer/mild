import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type InitDeps, type SetupState, runInit } from '../src/cli/init.ts';
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
function wizard(
  answers: (string | number)[],
  state: { client?: boolean; accounts?: string[]; models?: string[]; loginFails?: boolean; progress?: number; access?: 'test' | 'publish' } = {},
) {
  const config = loadConfig({ SIFT_HOME: freshHome() });
  const said: string[] = [];
  const asked: string[] = [];
  const calls: string[] = [];
  // With no progress given, a home that has a client is one that finished setup as a test user.
  const finished = state.client === true && state.progress === undefined;
  const access = state.access ?? (finished ? 'test' : undefined);
  const world: { client: boolean; accounts: string[]; setup: SetupState } = {
    client: state.client ?? false,
    accounts: [...(state.accounts ?? [])],
    setup: { googleTasks: state.progress ?? (finished ? 6 : 0), ...(access ? { access } : {}) },
  };
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
    waiting: record,
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
    setupState: () => world.setup,
    saveSetupState: (next) => {
      world.setup = next;
    },
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
  return { deps, config, said, asked, calls, world, text: () => said.join('\n') };
}

const CLIENT = '{"installed":{}}';
/** The five tasks everyone does: three pauses, the client paste, one more pause. */
const COMMON = ['done', 'done', 'done', CLIENT, 'done'];
const TEST_USER = 0;
const PUBLISH = 1;
/** The whole Google setup as a test user. */
const GOOGLE = [...COMMON, TEST_USER, 'done'];
const KEEP = 0;
const REDO = 1;
const links = (said: string[]) => said.filter((line) => line.startsWith('link: ')).map((line) => line.slice(6).replace('https://console.cloud.google.com', ''));

describe('sift init', () => {
  it('walks a new user through every step and writes the files', async () => {
    const w = wizard([...GOOGLE, 0, 0]);
    await runInit(w.deps);

    expect(w.calls).toEqual([`install ${CLIENT}`, 'gmail', 'login openai-codex oauth']);
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings).toEqual({ ...DEFAULT_SETTINGS, model: 'openai-codex/small' });
    expect(readFileSync(w.config.guidelinesPath, 'utf8')).toContain('Guidelines for sift');
    expect(w.text()).toContain('ok: Connected');
    expect(w.text()).toContain('Newsletters');
    expect(w.text()).toContain('Ready');
  });

  it('gives each Google task its link and values, and takes the client JSON at the task that produces it', async () => {
    const w = wizard([...GOOGLE, 3]);
    await runInit(w.deps);
    expect(links(w.said)).toEqual([
      '/projectcreate',
      '/apis/library/gmail.googleapis.com',
      '/auth/overview',
      '/auth/clients',
      '/auth/scopes',
      '/auth/audience',
    ]);
    expect(w.asked.slice(0, 7)).toEqual(['pause', 'pause', 'pause', 'Paste the JSON here (s to stop):', 'pause', 'Who signs in to this app?', 'pause']);
    expect(w.text()).toContain('Audience: External');
    expect(w.text()).toContain('Application type: Desktop app');
    expect(w.text()).toContain('Open "Data Access" in the left menu');
    expect(w.text()).toContain('Scopes: https://www.googleapis.com/auth/gmail.modify');
    expect(w.text()).toContain('Under "Test users"');
    expect(w.world.setup).toEqual({ googleTasks: 6, access: 'test' });
  });

  it('branches to branding and publishing when the user chooses to publish', async () => {
    const w = wizard([...COMMON, PUBLISH, 'done', 'done', 3]);
    await runInit(w.deps);
    expect(links(w.said).slice(5)).toEqual(['/auth/branding', '/auth/audience']);
    expect(w.world.setup).toEqual({ googleTasks: 7, access: 'publish' });
    expect(w.calls).toEqual([`install ${CLIENT}`, 'gmail']);
  });

  it('resumes the Google tasks where an earlier run stopped, and holds Gmail sign-in until they are done', async () => {
    const first = wizard(['done', 'done', 'skip', 3]);
    await runInit(first.deps);
    expect(first.world.setup).toEqual({ googleTasks: 2 });
    expect(first.text()).toContain('skip: Stopped here');
    expect(first.text()).toContain('skip: Needs step 1 finished');
    expect(first.text()).toContain('warn: Still needed: the Google client and a Gmail account');

    // The client is saved but the run stopped at scopes.
    const partway = wizard(['skip', 3], { client: true, progress: 4 });
    await runInit(partway.deps);
    expect(partway.calls).toEqual([]);
    expect(partway.text()).toContain('skip: Needs step 1 finished');

    const later = wizard(['done', TEST_USER, 'done', 3], { client: true, progress: 4 });
    await runInit(later.deps);
    expect(links(later.said)).toEqual(['/auth/scopes', '/auth/audience']);
    expect(later.calls).toEqual(['gmail']);

    // Stopped after choosing to publish: the choice is remembered.
    const chosen = wizard(['done', 'done', 3], { client: true, progress: 5, access: 'publish' });
    await runInit(chosen.deps);
    expect(links(chosen.said)).toEqual(['/auth/branding', '/auth/audience']);
    expect(chosen.asked).not.toContain('Who signs in to this app?');
  });

  it('offers each finished step with one keystroke to keep it', async () => {
    const w = wizard([KEEP, KEEP, KEEP], { client: true, accounts: ['me@example.org'] });
    saveSettings(w.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(w.deps);
    expect(w.asked).toHaveLength(3);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('ok: Client in place');
    expect(w.text()).toContain('ok: Using');
    expect(w.text()).toContain('Ready');
  });

  it('lets a finished step be redone: a new client, another account, a different model', async () => {
    const w = wizard([REDO, ...GOOGLE, REDO, REDO, 1, 1], { client: true, accounts: ['first@example.org'] });
    saveSettings(w.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(w.deps);
    expect(w.calls).toEqual([`install ${CLIENT}`, 'gmail', 'login openai api_key']);
    expect(w.world.accounts).toEqual(['first@example.org', 'me@example.org']);
    expect(w.config.settings.model).toBe('openai/large');
  });

  it('asks again when the pasted client is the wrong kind, and stops on s', async () => {
    const w = wizard(['done', 'done', 'done', '{"web":{}}', CLIENT, 'done', TEST_USER, 'done', 1, 1]);
    await runInit(w.deps);
    expect(w.calls).toEqual(['install {"web":{}}', `install ${CLIENT}`, 'gmail', 'login openai api_key']);
    expect(w.text()).toContain('fail: What you pasted is not a Desktop app client');

    const stopped = wizard(['done', 'done', 'done', 's', 3]);
    await runInit(stopped.deps);
    expect(stopped.world.setup.googleTasks).toBe(3);
    expect(stopped.calls).toEqual([]);
  });

  it('keeps going when model sign-in fails, and takes a typed id when no models are listed', async () => {
    const failed = wizard([KEEP, KEEP, 0], { client: true, accounts: ['me@example.org'], loginFails: true });
    await runInit(failed.deps);
    expect(failed.text()).toContain('fail: Sign-in did not finish: cancelled');
    expect(failed.config.settings.model).toBeUndefined();
    expect(failed.text()).toContain('Ready');

    const typed = wizard([KEEP, KEEP, 2, 'claude-test'], { client: true, accounts: ['me@example.org'], models: [] });
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
