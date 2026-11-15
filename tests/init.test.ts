import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type InitDeps, type SetupState, runInit } from '../src/cli/init.ts';
import { dashboardUrls, listenAddresses, localAddresses, machineNames, resolveHere } from '../src/cli/network.ts';
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
  state: {
    client?: 'web' | 'desktop';
    accounts?: string[];
    models?: string[];
    loginFails?: boolean;
    progress?: number;
    access?: 'test' | 'publish';
    location?: 'ask' | 'remote';
    tailscale?: string | null;
    serveFails?: boolean;
  } = {},
) {
  const config = loadConfig({ SIFT_HOME: freshHome() });
  const said: string[] = [];
  const asked: string[] = [];
  const calls: string[] = [];
  // With no progress given, a home that has a client is one that finished setup as a test user.
  const finished = state.client !== undefined && state.progress === undefined;
  const access = state.access ?? (finished ? 'test' : undefined);
  const world: { client: 'web' | 'desktop' | null; accounts: string[]; setup: SetupState } = {
    client: state.client ?? null,
    accounts: [...(state.accounts ?? [])],
    setup: {
      googleTasks: state.progress ?? (finished ? 6 : 0),
      ...(access ? { access } : {}),
      ...(state.location === 'remote' ? { location: 'remote' as const } : finished && state.location !== 'ask' ? { location: 'local' as const } : {}),
    },
  };
  // Step 1 always asks one thing first: where sift runs (new home) or whether to keep that (finished home).
  // Unless a test is about that step, answer with the first option: this machine, or keep it.
  if (state.location !== 'ask') answers.unshift(0);
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
    hasGoogleClient: () => world.client !== null,
    googleClientKind: () => world.client,
    setupState: () => world.setup,
    saveSetupState: (next) => {
      world.setup = next;
    },
    installGoogleClient: (json) => {
      calls.push(`install ${json}`);
      if (json.includes('nonsense')) throw new Error('What you pasted is not a Google OAuth client');
      world.client = json.includes('web') ? 'web' : 'desktop';
    },
    connectedAccounts: () => world.accounts,
    loginModel: async (choice) => {
      calls.push(`login ${choice.provider} ${choice.type}`);
      if (state.loginFails) throw new Error('cancelled');
    },
    availableModels: async () => state.models ?? ['small', 'large'],
    categories: () => [...DEFAULT_CATEGORIES],
    tailscaleName: () => (state.tailscale === undefined ? 'box.example.ts.net' : state.tailscale),
    enableTailscaleServe: async (port) => {
      calls.push(`serve ${port}`);
      if (state.serveFails) throw new Error('Access denied: serve config denied');
    },
  };
  return { deps, config, said, asked, calls, world, text: () => said.join('\n') };
}

const CLIENT = '{"web":{}}';
/** The five tasks everyone does: three pauses, the client paste, one more pause. */
const COMMON = ['done', 'done', 'done', CLIENT, 'done'];
const TEST_USER = 0;
const PUBLISH = 1;
/** The whole Google setup as a test user. */
const GOOGLE = [...COMMON, TEST_USER, 'done'];
const KEEP = 0;
const REDO = 1;
const NO_MODEL = 3;
const links = (said: string[]) => said.filter((line) => line.startsWith('link: ')).map((line) => line.slice(6).replace('https://console.cloud.google.com', ''));

describe('sift init', () => {
  it('walks a new user through setup, and leaves connecting Gmail to the browser', async () => {
    const w = wizard([...GOOGLE, 0, 0]);
    await runInit(w.deps);

    expect(w.calls).toEqual([`install ${CLIENT}`, 'login openai-codex oauth']);
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings).toEqual({ ...DEFAULT_SETTINGS, model: 'openai-codex/small' });
    expect(readFileSync(w.config.guidelinesPath, 'utf8')).toContain('Guidelines for sift');
    expect(w.text()).toContain('signing in to the dashboard with Google is what connects the account');
    expect(w.text()).toMatch(/Ready.*sift run.*http:\/\/localhost:8787.*sign in with Google/);
  });

  it('gives each Google task its link and values, with the redirect URIs the client needs', async () => {
    const w = wizard([...GOOGLE, NO_MODEL]);
    await runInit(w.deps);
    expect(links(w.said)).toEqual([
      '/projectcreate',
      '/apis/library/gmail.googleapis.com',
      '/auth/overview',
      '/auth/clients',
      '/auth/scopes',
      '/auth/audience',
    ]);
    expect(w.asked.slice(1, 8)).toEqual(['pause', 'pause', 'pause', 'Paste the JSON here (s to stop):', 'pause', 'Who signs in to this app?', 'pause']);
    expect(w.text()).toContain('Audience: External');
    expect(w.text()).toContain('Application type: Web application');
    expect(w.text()).toContain('Authorised redirect URIs: http://localhost:8787/auth/callback');
    expect(w.text()).toContain('https://box.example.ts.net/auth/callback');
    expect(w.text()).toContain('Open "Data Access" in the left menu');
    expect(w.text()).toContain('Scopes: https://www.googleapis.com/auth/gmail.modify');
    expect(w.text()).toContain('Under "Test users"');
    expect(w.world.setup).toEqual({ googleTasks: 6, access: 'test', location: 'local' });
  });

  it('branches to branding and publishing when the user chooses to publish', async () => {
    const w = wizard([...COMMON, PUBLISH, 'done', 'done', NO_MODEL]);
    await runInit(w.deps);
    expect(links(w.said).slice(5)).toEqual(['/auth/branding', '/auth/audience']);
    expect(w.world.setup).toEqual({ googleTasks: 7, access: 'publish', location: 'local' });
  });

  it('resumes the Google tasks where an earlier run stopped', async () => {
    const first = wizard(['done', 'done', 'skip', NO_MODEL]);
    await runInit(first.deps);
    expect(first.world.setup).toEqual({ googleTasks: 2, location: 'local' });
    expect(first.text()).toContain('skip: Stopped here');
    expect(first.text()).toContain('skip: Needs step 2 finished');
    expect(first.text()).toContain('warn: Still needed: the Google client');

    const later = wizard(['done', TEST_USER, 'done', NO_MODEL], { client: 'web', progress: 4 });
    await runInit(later.deps);
    expect(links(later.said)).toEqual(['/auth/scopes', '/auth/audience']);
    expect(later.text()).toContain('Ready');

    // Stopped after choosing to publish: the choice is remembered.
    const chosen = wizard(['done', 'done', NO_MODEL], { client: 'web', progress: 5, access: 'publish' });
    await runInit(chosen.deps);
    expect(links(chosen.said)).toEqual(['/auth/branding', '/auth/audience']);
    expect(chosen.asked).not.toContain('Who signs in to this app?');
  });

  it('offers each finished step with one keystroke to keep it', async () => {
    const w = wizard([KEEP, KEEP], { client: 'web', accounts: ['me@example.org'] });
    saveSettings(w.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(w.deps);
    expect(w.asked).toHaveLength(3);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('ok: Client in place');
    expect(w.text()).toContain('ok: Using');
    expect(w.text()).toContain('ok: Connected');
    expect(w.text()).toContain('Newsletters');
    expect(w.text()).not.toContain('sign in with Google');
  });

  it('lets a finished step be redone: a new client, a different model', async () => {
    const w = wizard([REDO, ...GOOGLE, REDO, 1, 1], { client: 'web', accounts: ['me@example.org'] });
    saveSettings(w.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(w.deps);
    expect(w.calls).toEqual([`install ${CLIENT}`, 'login openai api_key']);
    expect(w.config.settings.model).toBe('openai/large');
  });

  it('asks again when what was pasted is not a client, and stops on s', async () => {
    const w = wizard(['done', 'done', 'done', '{"nonsense":{}}', CLIENT, 'done', TEST_USER, 'done', NO_MODEL]);
    await runInit(w.deps);
    expect(w.calls).toEqual(['install {"nonsense":{}}', `install ${CLIENT}`]);
    expect(w.text()).toContain('fail: What you pasted is not a Google OAuth client');

    const stopped = wizard(['done', 'done', 'done', 's', NO_MODEL]);
    await runInit(stopped.deps);
    expect(stopped.world.setup.googleTasks).toBe(3);
    expect(stopped.calls).toEqual([]);
  });

  it('on a server, serves the dashboard over Tailscale HTTPS so Google can sign people in', async () => {
    const server = wizard([1, 0, 'skip', NO_MODEL], { location: 'ask' });
    await runInit(server.deps);
    expect(server.asked.slice(0, 2)).toEqual(['Where will you open the dashboard?', expect.stringContaining('tailscale serve --bg 8787')]);
    expect(server.calls).toEqual(['serve 8787']);
    expect(server.world.setup.location).toBe('remote');
    expect(server.config.settings.dashboardHost).toBeUndefined();
    expect(server.text()).toContain('ok: Dashboard at');
    expect(server.text()).toContain('https://box.example.ts.net');

    // When serve cannot be started, the command is shown to run by hand.
    const denied = wizard([1, 0, 'skip', NO_MODEL], { location: 'ask', serveFails: true });
    await runInit(denied.deps);
    expect(denied.text()).toContain('fail: Access denied: serve config denied');
    expect(denied.text()).toContain('with sudo if it asks');

    // Without Tailscale there is no HTTPS address to offer.
    const bare = wizard([1, 'skip', NO_MODEL], { location: 'ask', tailscale: null });
    await runInit(bare.deps);
    expect(bare.calls).toEqual([]);
    expect(bare.text()).toContain('warn: Google only signs people in at localhost or an HTTPS address');
  });

  it('replaces a Desktop client', async () => {
    const w = wizard([CLIENT, KEEP], { client: 'desktop', accounts: ['me@example.org'], location: 'remote' });
    saveSettings(w.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    w.world.setup = { googleTasks: 6, access: 'test', location: 'remote' };
    await runInit(w.deps);
    expect(w.text()).toContain('warn: Your client is a Desktop app client');
    expect(links(w.said)).toEqual(['/auth/clients']);
    expect(w.world.client).toBe('web');
    expect(w.world.setup.googleTasks).toBe(6);
    expect(w.text()).toMatch(/Ready.*https:\/\/box\.example\.ts\.net/);
  });

  it('keeps going when model sign-in fails, and takes a typed id when no models are listed', async () => {
    const failed = wizard([KEEP, 0], { client: 'web', accounts: ['me@example.org'], loginFails: true });
    await runInit(failed.deps);
    expect(failed.text()).toContain('fail: Sign-in did not finish: cancelled');
    expect(failed.config.settings.model).toBeUndefined();
    expect(failed.text()).toContain('Ready');

    const typed = wizard([KEEP, 2, 'claude-test'], { client: 'web', accounts: ['me@example.org'], models: [] });
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
    const settings = { model: 'openai-codex/some-model', act: true, interval: 120, dashboardPort: 9000, dashboardHost: 'box.example.ts.net' };
    expect(parseSettings(renderSettings(settings))).toEqual(settings);
    expect(parseSettings(renderSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects typos and wrong types with the setting named', () => {
    expect(() => parseSettings('modle = "a/b"')).toThrow('unknown setting modle');
    expect(() => parseSettings('act = "yes"')).toThrow('act must be true or false');
    expect(() => parseSettings('model = "no-slash"')).toThrow('provider/model-id');
    expect(() => parseSettings('interval = 1')).toThrow('at least 5');
    expect(() => parseSettings('[dashboard]\nbind = "x"')).toThrow('unknown setting dashboard.bind');
    expect(() => parseSettings('[dashboard]\nhost = "http://x/"')).toThrow('dashboard.host must be a hostname or IP address');
    expect(() => parseSettings('act = ')).toThrow('not valid TOML');
  });

  it('installs a pasted Web application client, or one given as a path, and refuses a Desktop one', () => {
    const config = loadConfig({ SIFT_HOME: freshHome() });
    const web = JSON.stringify({ web: { client_id: 'id', client_secret: 'secret' } }, null, 2);
    const desktop = JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } });

    expect(() => installClient(config, JSON.stringify({ other: {} }))).toThrow('not a Google OAuth client');
    expect(() => installClient(config, '{"web": ')).toThrow('not valid JSON');
    expect(() => loadClientSecrets(config, {})).toThrow('Run `sift init`');

    installClient(config, `  ${web}\n`);
    expect(loadClientSecrets(config, {})).toEqual({ clientId: 'id', clientSecret: 'secret', kind: 'web' });

    const other = loadConfig({ SIFT_HOME: freshHome() });
    const file = join(freshHome(), 'client.json');
    writeFileSync(file, web);
    installClient(other, file);
    expect(loadClientSecrets(other, {}).kind).toBe('web');

    expect(() => installClient(other, desktop)).toThrow('Desktop app client');
    writeFileSync(other.googleClientPath, desktop);
    expect(loadClientSecrets(other, {}).kind).toBe('desktop');
  });
});

describe('network', () => {
  it('lists only addresses another machine could reach', () => {
    for (const { address } of localAddresses()) expect(address.startsWith('127.')).toBe(false);
  });

  it('accepts a host only if it is an address of this machine', async () => {
    expect(await resolveHere('127.0.0.1')).toBe('127.0.0.1');
    expect(await resolveHere('192.0.2.1')).toBeNull();
    expect(await resolveHere('no-such-host.invalid')).toBeNull();
  });

  it('listens on localhost alone, one more address, or everything, as the setting says', async () => {
    expect(await listenAddresses(DEFAULT_SETTINGS)).toEqual(['127.0.0.1']);
    expect(await listenAddresses({ ...DEFAULT_SETTINGS, dashboardHost: 'all' })).toEqual(['::']);
    expect(parseSettings('[dashboard]\nhost = "0.0.0.0"').dashboardHost).toBe('all');
    await expect(listenAddresses({ ...DEFAULT_SETTINGS, dashboardHost: '192.0.2.1' })).rejects.toThrow('does not point at this machine');
    for (const { address } of localAddresses()) expect(await listenAddresses({ ...DEFAULT_SETTINGS, dashboardHost: address })).toEqual(['127.0.0.1', address]);
  });

  it("answers to this machine's own names and addresses, and prints URLs a browser can use", () => {
    const names = machineNames();
    for (const { address } of localAddresses()) expect(names).toContain(address);
    expect(names.some((name) => name.endsWith('.local'))).toBe(true);
    expect(names).not.toContain('localhost');

    expect(dashboardUrls(DEFAULT_SETTINGS)).toEqual(['http://localhost:8787']);
    expect(dashboardUrls({ ...DEFAULT_SETTINGS, dashboardHost: '192.0.2.9' }, 9000)).toEqual(['http://192.0.2.9:9000']);
    for (const url of dashboardUrls({ ...DEFAULT_SETTINGS, dashboardHost: 'all' })) expect(url).toMatch(/^http:\/\/[^/]+:8787$/);
  });
});
