import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type InitDeps, type SetupState, recommendModel, runInit } from '../src/cli/init.ts';
import { dashboardUrls, listenAddresses, localAddresses, machineNames, resolveHere } from '../src/cli/network.ts';
import type { Ui } from '../src/cli/ui.ts';
import { DEFAULT_SETTINGS, GUIDELINES_TEMPLATE, loadConfig, parseSettings, renderSettings, resolveHome, saveSettings } from '../src/config.ts';
import { DEFAULT_LABELS } from '../src/store/labels.ts';
import { installClient, loadClientSecrets } from '../src/gmail/auth.ts';

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
    /** Answers for the sign-in list. Without them the step is answered with Enter: no limit. */
    allow?: string[];
    /** The step to change when setup is finished and init lists them. Without it, none. */
    change?: number;
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
  // The first question is where sift runs (a home with no answer yet) or which step to change (a finished one).
  // Unless a test is about that, answer with the first option: this machine, or none.
  if (finished && state.client === 'web') answers.unshift(state.change ?? 0);
  else if (state.location === undefined) answers.unshift(0);
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
    text: async (question) => (question.startsWith('Addresses allowed') ? (state.allow?.shift() ?? '') : String(next(question))),
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
const NO_MODEL = 3;
/** Positions in the list of steps a finished setup offers to change. */
const CLIENT_STEP = 2;
const MODEL_STEP = 3;
const SIGN_IN_STEP = 4;
const links = (said: string[]) => said.filter((line) => line.startsWith('link: ')).map((line) => line.slice(6).replace('https://console.cloud.google.com', ''));

describe('sift init', () => {
  it('walks a new user through setup, and leaves connecting Gmail to the browser', async () => {
    const w = wizard([...GOOGLE, 0, 0]);
    await runInit(w.deps);

    expect(w.calls).toEqual([`install ${CLIENT}`, 'login openai-codex oauth']);
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings).toEqual({ ...DEFAULT_SETTINGS, model: 'openai-codex/small' });
    expect(readFileSync(w.config.guidelinesPath, 'utf8')).toBe(GUIDELINES_TEMPLATE);
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

  it('lists the steps of a finished setup with what each is set to, and changes nothing unless asked', async () => {
    const w = wizard([], { client: 'web', accounts: ['me@example.org'] });
    saveSettings(w.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(w.deps);
    expect(w.asked).toEqual(['Change a step?']);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('Where sift runs: Dashboard at');
    expect(w.text()).toContain('Google OAuth client: Client in place');
    expect(w.text()).toContain('Model: openai/x');
    expect(w.text()).toContain('Who can sign in: ');
    expect(w.text()).toContain('Gmail account: me@example.org');
    expect(w.config.settings).toEqual({ ...DEFAULT_SETTINGS, model: 'openai/x' });
    expect(w.text()).toMatch(/Ready.*sift run/);
    expect(w.text()).not.toContain('sign in with Google');
  });

  it('redoes the one step picked from a finished setup: a new client, a different model, no model', async () => {
    const client = wizard([...GOOGLE], { client: 'web', accounts: ['me@example.org'], change: CLIENT_STEP });
    saveSettings(client.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(client.deps);
    expect(client.calls).toEqual([`install ${CLIENT}`]);
    expect(client.config.settings.model).toBe('openai/x');

    const model = wizard([1, 1], { client: 'web', accounts: ['me@example.org'], change: MODEL_STEP });
    saveSettings(model.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(model.deps);
    expect(model.calls).toEqual(['login openai api_key']);
    expect(model.config.settings.model).toBe('openai/large');

    const none = wizard([NO_MODEL], { client: 'web', accounts: ['me@example.org'], change: MODEL_STEP });
    saveSettings(none.config, { ...DEFAULT_SETTINGS, model: 'openai/x' });
    await runInit(none.deps);
    expect(loadConfig({ SIFT_HOME: none.config.home }).settings.model).toBeUndefined();

    // A client left half redone is no longer a finished setup: the next run carries on with it.
    const stopped = wizard(['done', 'skip'], { client: 'web', accounts: ['me@example.org'], change: CLIENT_STEP });
    await runInit(stopped.deps);
    expect(stopped.world.setup).toEqual({ googleTasks: 1, location: 'local' });
    expect(stopped.text()).toContain('warn: Still needed: the Google client');
  });

  it('limits sign-in to the addresses given, asking again for one that is not an address', async () => {
    const w = wizard([...GOOGLE, NO_MODEL], { allow: ['me@example.org, nonsense', 'Me@Example.org, work@example.com'] });
    await runInit(w.deps);
    expect(w.text()).toContain('fail: nonsense is not an email address.');
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings.dashboardAllow).toEqual(['me@example.org', 'work@example.com']);

    // Changing the list to one that leaves a connected account out says what that means; Enter removes the limit.
    const narrowed = wizard([], { client: 'web', accounts: ['me@example.org'], allow: ['work@example.com'], change: SIGN_IN_STEP });
    saveSettings(narrowed.config, { ...DEFAULT_SETTINGS, model: 'openai/x', dashboardAllow: ['me@example.org'] });
    await runInit(narrowed.deps);
    expect(narrowed.config.settings.dashboardAllow).toEqual(['work@example.com']);
    expect(narrowed.text()).toContain('warn: me@example.org is connected but can no longer sign in');

    const lifted = wizard([], { client: 'web', accounts: ['me@example.org'], change: SIGN_IN_STEP });
    saveSettings(lifted.config, { ...DEFAULT_SETTINGS, model: 'openai/x', dashboardAllow: ['me@example.org'] });
    await runInit(lifted.deps);
    expect(loadConfig({ SIFT_HOME: lifted.config.home }).settings.dashboardAllow).toBeUndefined();
  });

  it('offers the recommended model first, so Enter takes it', async () => {
    const w = wizard([...GOOGLE, 0, 0], { models: ['gpt-9', 'gpt-9-luna', 'gpt-10-luna'] });
    await runInit(w.deps);
    expect(w.config.settings.model).toBe('openai-codex/gpt-10-luna');
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
    const w = wizard([CLIENT], { client: 'desktop', accounts: ['me@example.org'], location: 'remote' });
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
    const failed = wizard([0], { client: 'web', accounts: ['me@example.org'], loginFails: true, change: MODEL_STEP });
    await runInit(failed.deps);
    expect(failed.text()).toContain('fail: Sign-in did not finish: cancelled');
    expect(failed.config.settings.model).toBeUndefined();
    expect(failed.text()).toContain('Ready');

    const typed = wizard([2, 'claude-test'], { client: 'web', accounts: ['me@example.org'], models: [], change: MODEL_STEP });
    await runInit(typed.deps);
    expect(typed.config.settings.model).toBe('anthropic/claude-test');
  });
});

describe('recommendModel', () => {
  it("picks the newest of the provider's small family, by version number", () => {
    expect(recommendModel('openai', ['gpt-9', 'gpt-9-luna', 'gpt-10-luna', 'gpt-10'])).toBe('gpt-10-luna');
    expect(recommendModel('openai-codex', ['luna-2.5', 'luna-2.10', 'sol-3'])).toBe('luna-2.10');
    expect(recommendModel('anthropic', ['claude-3-5-haiku-20241022', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'])).toBe('claude-haiku-4-5-20251001');
    expect(recommendModel('google', ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3-pro'])).toBe('gemini-3-flash');
  });

  it('prefers the plain name over a dated or variant one of the same version', () => {
    expect(recommendModel('anthropic', ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'])).toBe('claude-haiku-4-5');
    expect(recommendModel('google', ['gemini-3-flash-lite', 'gemini-3-flash'])).toBe('gemini-3-flash');
    expect(recommendModel('openai', ['gpt-9-luna-2026-03-01', 'gpt-9-luna'])).toBe('gpt-9-luna');
  });

  it('recommends nothing without a family member, for an unknown provider, or for a name that only contains the word', () => {
    expect(recommendModel('openai', ['gpt-9', 'gpt-9-mini'])).toBeNull();
    expect(recommendModel('example', ['luna-1'])).toBeNull();
    expect(recommendModel('openai', ['lunar-1'])).toBeNull();
    expect(recommendModel('openai', [])).toBeNull();
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

  it('starts the guidelines as instructions that keep mail when unsure and never ask for deletion', () => {
    expect(GUIDELINES_TEMPLATE).toContain('When in doubt, keep it in my inbox.');
    expect(GUIDELINES_TEMPLATE).not.toMatch(/delet|trash|replace these/i);
    const named = DEFAULT_LABELS.filter((l) => GUIDELINES_TEMPLATE.includes(l.name)).map((l) => l.id);
    expect(named).toEqual(['personal', 'security', 'newsletter', 'marketing', 'cold_outreach', 'junk', 'phishing']);
  });

  it('round-trips through sift.toml', () => {
    const settings = {
      model: 'openai-codex/some-model',
      act: true,
      heuristics: true,
      interval: 120,
      dashboardPort: 9000,
      dashboardHost: 'box.example.ts.net',
      dashboardAllow: ['me@example.org', 'work@example.com'],
    };
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
    expect(() => parseSettings('[dashboard]\nallow = "me@example.org"')).toThrow('dashboard.allow must be a list of email addresses');
    expect(() => parseSettings('[dashboard]\nallow = ["me"]')).toThrow('dashboard.allow');
    expect(() => parseSettings('[dashboard]\nallow = []')).toThrow('dashboard.allow');
    expect(parseSettings('[dashboard]\nallow = ["Me@Example.org"]').dashboardAllow).toEqual(['me@example.org']);
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
