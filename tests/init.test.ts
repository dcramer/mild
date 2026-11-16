import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type InitDeps, type SetupState, runInit } from '../src/cli/init.ts';
import { dashboardUrls, listenAddresses, localAddresses, machineNames, resolveHere } from '../src/cli/network.ts';
import type { Ui } from '../src/cli/ui.ts';
import { DEFAULT_SETTINGS, loadConfig, parseSettings, renderSettings, resolveHome, saveSettings } from '../src/config.ts';
import { DEFAULT_GUIDELINES } from '../src/store/preferences.ts';
import { DEFAULT_LABELS } from '../src/store/labels.ts';
import { loadKeyring } from '../src/secrets.ts';
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
    progress?: number;
    access?: 'test' | 'publish';
    location?: 'ask' | 'remote';
    tailscale?: string | null;
    serveFails?: boolean;
    /** Answers for the sign-in list. Without them the step is answered with Enter: no limit. */
    allow?: string[];
    /** The step to change when setup is finished and init lists them. Without it, none. */
    change?: number;
    /** A SIFT_KEY already set. */
    key?: string;
    keyFails?: boolean;
  } = {},
) {
  const config = loadConfig({ SIFT_HOME: freshHome(), ...(state.key ? { SIFT_KEY: state.key } : {}) });
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
    saveKey: (key) => {
      calls.push('save key');
      if (state.keyFails) throw new Error('read-only file system');
      Object.assign(config.keys, loadKeyring({ SIFT_KEY: key }));
      return '/work/sift/.env';
    },
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
    connectedAccounts: async () => world.accounts,
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
/** Positions in the list of steps a finished setup offers to change. */
const KEY_STEP = 1;
const CLIENT_STEP = 3;
const SIGN_IN_STEP = 4;
const links = (said: string[]) => said.filter((line) => line.startsWith('link: ')).map((line) => line.slice(6).replace('https://console.cloud.google.com', ''));

describe('sift init', () => {
  it('walks a new user through setup, and leaves connecting Gmail to the browser', async () => {
    const w = wizard([...GOOGLE]);
    await runInit(w.deps);

    expect(w.calls).toEqual(['save key', `install ${CLIENT}`]);
    expect(w.config.keys.current).not.toBeNull();
    expect(w.text()).toContain('ok: Saved as SIFT_KEY in /work/sift/.env');
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings).toEqual(DEFAULT_SETTINGS);
    expect(w.text()).toContain('signing in to the dashboard with Google is what connects the account');
    expect(w.text()).toMatch(/Ready.*sift run.*http:\/\/localhost:8787.*sign in with Google/);
  });

  it('gives each Google task its link and values, with the redirect URIs the client needs', async () => {
    const w = wizard([...GOOGLE]);
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
    const w = wizard([...COMMON, PUBLISH, 'done', 'done']);
    await runInit(w.deps);
    expect(links(w.said).slice(5)).toEqual(['/auth/branding', '/auth/audience']);
    expect(w.world.setup).toEqual({ googleTasks: 7, access: 'publish', location: 'local' });
  });

  it('resumes the Google tasks where an earlier run stopped', async () => {
    const first = wizard(['done', 'done', 'skip']);
    await runInit(first.deps);
    expect(first.world.setup).toEqual({ googleTasks: 2, location: 'local' });
    expect(first.text()).toContain('skip: Stopped here');
    expect(first.text()).toContain('skip: Needs step 3 finished');
    expect(first.text()).toContain('warn: Still needed: the Google client');

    const later = wizard(['done', TEST_USER, 'done'], { client: 'web', progress: 4 });
    await runInit(later.deps);
    expect(links(later.said)).toEqual(['/auth/scopes', '/auth/audience']);
    expect(later.text()).toContain('Ready');

    // Stopped after choosing to publish: the choice is remembered.
    const chosen = wizard(['done', 'done'], { client: 'web', progress: 5, access: 'publish' });
    await runInit(chosen.deps);
    expect(links(chosen.said)).toEqual(['/auth/branding', '/auth/audience']);
    expect(chosen.asked).not.toContain('Who signs in to this app?');
  });

  it('lists the steps of a finished setup with what each is set to, and changes nothing unless asked', async () => {
    const w = wizard([], { client: 'web', accounts: ['me@example.org'] });
    saveSettings(w.config, DEFAULT_SETTINGS);
    await runInit(w.deps);
    expect(w.asked).toEqual(['Change a step?']);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('Where sift runs: Dashboard at');
    expect(w.text()).toContain('Google OAuth client: Client in place');
    expect(w.text()).toContain('Who can sign in: ');
    expect(w.text()).toContain('Gmail account: me@example.org');
    expect(w.config.settings).toEqual(DEFAULT_SETTINGS);
    expect(w.text()).toMatch(/Ready.*sift run/);
    expect(w.text()).not.toContain('sign in with Google');
  });

  it('redoes the one step picked from a finished setup', async () => {
    const client = wizard([...GOOGLE], { client: 'web', accounts: ['me@example.org'], change: CLIENT_STEP });
    saveSettings(client.config, DEFAULT_SETTINGS);
    await runInit(client.deps);
    expect(client.calls).toEqual([`install ${CLIENT}`]);

    // A client left half redone is no longer a finished setup: the next run carries on with it.
    const stopped = wizard(['done', 'skip'], { client: 'web', accounts: ['me@example.org'], change: CLIENT_STEP });
    await runInit(stopped.deps);
    expect(stopped.world.setup).toEqual({ googleTasks: 1, location: 'local' });
    expect(stopped.text()).toContain('warn: Still needed: the Google client');
  });

  it('generates the encryption key before any credential is stored, and shows it when it cannot be saved', async () => {
    const saved = wizard([...GOOGLE]);
    await runInit(saved.deps);
    expect(saved.said.indexOf('ok: Saved as SIFT_KEY in /work/sift/.env')).toBeLessThan(saved.said.findIndex((line) => line.startsWith('link: ')));
    expect(saved.text()).toContain('sift reads it only when started from this directory');

    const failed = wizard([...GOOGLE], { keyFails: true });
    await runInit(failed.deps);
    expect(failed.config.keys.current).toBeNull();
    expect(failed.text()).toContain('fail: Could not save the key: read-only file system');
    expect(failed.said[failed.said.findIndex((line) => line.includes('Set this as SIFT_KEY')) + 1]).toMatch(/^[\w-]{43}$/);

    // A finished setup without one lists it, and makes one when picked; with one set it is never replaced.
    const later = wizard([], { client: 'web', accounts: ['me@example.org'], change: KEY_STEP });
    await runInit(later.deps);
    expect(later.text()).toContain('Encryption key: none, credentials stored plain');
    expect(later.calls).toEqual(['save key']);

    const set = wizard([], { client: 'web', accounts: ['me@example.org'], key: 'key-a', change: KEY_STEP });
    await runInit(set.deps);
    expect(set.text()).toContain(`Encryption key: Credentials encrypted · key ${set.config.keys.current!.id}`);
    expect(set.text()).toContain('SIFT_OLD_KEYS');
    expect(set.calls).toEqual([]);
  });

  it('limits sign-in to the addresses given, asking again for one that is not an address', async () => {
    const w = wizard([...GOOGLE], { allow: ['me@example.org, nonsense', 'Me@Example.org, work@example.com'] });
    await runInit(w.deps);
    expect(w.text()).toContain('fail: nonsense is not an email address.');
    expect(loadConfig({ SIFT_HOME: w.config.home }).settings.dashboardAllow).toEqual(['me@example.org', 'work@example.com']);

    // Changing the list to one that leaves a connected account out says what that means; Enter removes the limit.
    const narrowed = wizard([], { client: 'web', accounts: ['me@example.org'], allow: ['work@example.com'], change: SIGN_IN_STEP });
    saveSettings(narrowed.config, { ...DEFAULT_SETTINGS, dashboardAllow: ['me@example.org'] });
    await runInit(narrowed.deps);
    expect(narrowed.config.settings.dashboardAllow).toEqual(['work@example.com']);
    expect(narrowed.text()).toContain('warn: me@example.org is connected but can no longer sign in');

    const lifted = wizard([], { client: 'web', accounts: ['me@example.org'], change: SIGN_IN_STEP });
    saveSettings(lifted.config, { ...DEFAULT_SETTINGS, dashboardAllow: ['me@example.org'] });
    await runInit(lifted.deps);
    expect(loadConfig({ SIFT_HOME: lifted.config.home }).settings.dashboardAllow).toBeUndefined();
  });

  it('asks again when what was pasted is not a client, and stops on s', async () => {
    const w = wizard(['done', 'done', 'done', '{"nonsense":{}}', CLIENT, 'done', TEST_USER, 'done']);
    await runInit(w.deps);
    expect(w.calls).toEqual(['save key', 'install {"nonsense":{}}', `install ${CLIENT}`]);
    expect(w.text()).toContain('fail: What you pasted is not a Google OAuth client');

    const stopped = wizard(['done', 'done', 'done', 's']);
    await runInit(stopped.deps);
    expect(stopped.world.setup.googleTasks).toBe(3);
    expect(stopped.calls).toEqual(['save key']);
  });

  it('on a server, serves the dashboard over Tailscale HTTPS so Google can sign people in', async () => {
    const server = wizard([1, 0, 'skip'], { location: 'ask' });
    await runInit(server.deps);
    expect(server.asked.slice(0, 2)).toEqual(['Where will you open the dashboard?', expect.stringContaining('tailscale serve --bg 8787')]);
    expect(server.calls).toEqual(['save key', 'serve 8787']);
    expect(server.world.setup.location).toBe('remote');
    expect(server.config.settings.dashboardHost).toBeUndefined();
    expect(server.text()).toContain('ok: Dashboard at');
    expect(server.text()).toContain('https://box.example.ts.net');

    // When serve cannot be started, the command is shown to run by hand.
    const denied = wizard([1, 0, 'skip'], { location: 'ask', serveFails: true });
    await runInit(denied.deps);
    expect(denied.text()).toContain('fail: Access denied: serve config denied');
    expect(denied.text()).toContain('with sudo if it asks');

    // Without Tailscale there is no HTTPS address to offer.
    const bare = wizard([1, 'skip'], { location: 'ask', tailscale: null });
    await runInit(bare.deps);
    expect(bare.calls).toEqual(['save key']);
    expect(bare.text()).toContain('warn: Google only signs people in at localhost or an HTTPS address');
  });

  it('replaces a Desktop client', async () => {
    const w = wizard([CLIENT], { client: 'desktop', accounts: ['me@example.org'], location: 'remote' });
    saveSettings(w.config, DEFAULT_SETTINGS);
    w.world.setup = { googleTasks: 6, access: 'test', location: 'remote' };
    await runInit(w.deps);
    expect(w.text()).toContain('warn: Your client is a Desktop app client');
    expect(links(w.said)).toEqual(['/auth/clients']);
    expect(w.world.client).toBe('web');
    expect(w.world.setup.googleTasks).toBe(6);
    expect(w.text()).toMatch(/Ready.*https:\/\/box\.example\.ts\.net/);
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
    for (const path of [config.settingsPath, config.databaseDir, config.googleClientPath, config.deviceIdPath]) {
      expect(path.startsWith(`${home}/`)).toBe(true);
    }
    expect(config.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('starts the guidelines as instructions that keep mail when unsure and never ask for deletion', () => {
    expect(DEFAULT_GUIDELINES).toContain('When in doubt, keep it in my inbox.');
    expect(DEFAULT_GUIDELINES).not.toMatch(/delet|trash|replace these/i);
    const named = DEFAULT_LABELS.filter((l) => DEFAULT_GUIDELINES.includes(l.name)).map((l) => l.id);
    expect(named).toEqual(['personal', 'security', 'newsletter', 'marketing', 'cold_outreach', 'junk', 'phishing']);
  });

  it('round-trips through sift.toml', () => {
    const settings = {
      act: true,
      heuristics: true,
      interval: 120,
      dashboardPort: 9000,
      dashboardHost: 'box.example.ts.net',
      dashboardAllow: ['me@example.org', 'work@example.com'],
      fewShot: false,
      examplesKeepDays: 90,
    };
    expect(parseSettings(renderSettings(settings))).toEqual(settings);
    expect(parseSettings(renderSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects typos and wrong types with the setting named', () => {
    expect(() => parseSettings('modle = "a/b"')).toThrow('unknown setting modle');
    expect(() => parseSettings('[examples]\nkeep_days = 0')).toThrow('examples.keep_days must be a whole number of days, at least 1');
    expect(() => parseSettings('act = "yes"')).toThrow('act must be true or false');
    expect(() => parseSettings('model = "openai/x"')).toThrow("the model is now each person's own");
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
