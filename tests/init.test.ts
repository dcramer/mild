import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { type InitDeps, type SetupState, runInit } from '../src/cli/init.ts';
import type { Ui } from '../src/cli/ui.ts';
import { DEFAULT_SETTINGS, type Config, loadConfig, readSettings, resolveHome, saveSetting } from '../src/config.ts';
import { loadKeyring } from '../src/secrets.ts';
import { installClient, loadClientSecrets } from '../src/gmail/auth.ts';
import { tempDir } from './helpers.ts';

/**
 * A wizard run with scripted answers. `state` is what already exists; the fakes change it as the real
 * steps would. Answers are consumed in order: a string for a text or paste prompt, a number for the
 * index chosen in a menu, and 'skip' or 'done' for a pause.
 */
function wizard(
  answers: (string | number)[],
  state: {
    client?: boolean;
    accounts?: string[];
    progress?: number;
    access?: 'test' | 'publish';
    location?: 'ask' | 'remote';
    tailscale?: string | null;
    serveFails?: boolean;
    /** The step to change when setup is finished and init lists them. Without it, none. */
    change?: number;
    /** A SIFT_KEY already set. */
    key?: string;
    keyFails?: boolean;
  } = {},
) {
  const config = loadConfig({ SIFT_HOME: tempDir(), ...(state.key ? { SIFT_KEY: state.key } : {}) });
  const said: string[] = [];
  const asked: string[] = [];
  const calls: string[] = [];
  // With no progress given, a home that has a client is one that finished setup as a test user.
  const finished = state.client === true && state.progress === undefined;
  const access = state.access ?? (finished ? 'test' : undefined);
  const world: { client: boolean; accounts: string[]; setup: SetupState } = {
    client: state.client ?? false,
    accounts: [...(state.accounts ?? [])],
    setup: {
      googleTasks: state.progress ?? (finished ? 6 : 0),
      ...(access ? { access } : {}),
      ...(state.location === 'remote' ? { location: 'remote' as const } : finished && state.location !== 'ask' ? { location: 'local' as const } : {}),
    },
  };
  // The first question is where sift runs (a home with no answer yet) or which step to change (a finished one).
  // Unless a test is about that, answer with the first option: this machine, or none.
  if (finished) answers.unshift(state.change ?? 0);
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
    saveSetting: (variable, value) => saveSetting(config, variable, value),
    saveKey: (key) => {
      calls.push('save key');
      if (state.keyFails) throw new Error('read-only file system');
      Object.assign(config.keys, loadKeyring({ SIFT_KEY: key }));
      return '/work/sift/.env';
    },
    hasGoogleClient: () => world.client,
    setupState: () => world.setup,
    saveSetupState: (next) => {
      world.setup = next;
    },
    installGoogleClient: (json) => {
      calls.push(`install ${json}`);
      if (json.includes('nonsense')) throw new Error('What you pasted is not a Google OAuth client');
      world.client = true;
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
const SENTRY_STEP = 4;
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
    expect(w.text()).not.toContain('https://box.example.ts.net/auth/callback');
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

    const later = wizard(['done', TEST_USER, 'done'], { client: true, progress: 4 });
    await runInit(later.deps);
    expect(links(later.said)).toEqual(['/auth/scopes', '/auth/audience']);
    expect(later.text()).toContain('Ready');

    // Stopped after choosing to publish: the choice is remembered.
    const chosen = wizard(['done', 'done'], { client: true, progress: 5, access: 'publish' });
    await runInit(chosen.deps);
    expect(links(chosen.said)).toEqual(['/auth/branding', '/auth/audience']);
    expect(chosen.asked).not.toContain('Who signs in to this app?');
  });

  it('lists the steps of a finished setup with what each is set to, and changes nothing unless asked', async () => {
    const w = wizard([], { client: true, accounts: ['me@example.org'] });
    await runInit(w.deps);
    expect(w.asked).toEqual(['Change a step?']);
    expect(w.calls).toEqual([]);
    expect(w.text()).toContain('Where Sift runs: Dashboard at');
    expect(w.text()).toContain('Google OAuth client: Client in place');
    expect(w.text()).toContain('Gmail account: me@example.org');
    expect(w.config.settings).toEqual(DEFAULT_SETTINGS);
    expect(w.text()).toMatch(/Ready.*sift run/);
    expect(w.text()).not.toContain('sign in with Google');
  });

  it('redoes the one step picked from a finished setup', async () => {
    const client = wizard([...GOOGLE], { client: true, accounts: ['me@example.org'], change: CLIENT_STEP });
    await runInit(client.deps);
    expect(client.calls).toEqual([`install ${CLIENT}`]);

    // A client left half redone is no longer a finished setup: the next run carries on with it.
    const stopped = wizard(['done', 'skip'], { client: true, accounts: ['me@example.org'], change: CLIENT_STEP });
    await runInit(stopped.deps);
    expect(stopped.world.setup).toEqual({ googleTasks: 1, location: 'local' });
    expect(stopped.text()).toContain('warn: Still needed: the Google client');
  });

  it('generates the encryption key before any credential is stored, and shows it when it cannot be saved', async () => {
    const saved = wizard([...GOOGLE]);
    await runInit(saved.deps);
    expect(saved.said.indexOf('ok: Saved as SIFT_KEY in /work/sift/.env')).toBeLessThan(saved.said.findIndex((line) => line.startsWith('link: ')));
    expect(saved.text()).toContain('Sift reads it only when started from this directory');

    const failed = wizard([...GOOGLE], { keyFails: true });
    await runInit(failed.deps);
    expect(failed.config.keys.current).toBeNull();
    expect(failed.text()).toContain('fail: Could not save the key: read-only file system');
    expect(failed.said[failed.said.findIndex((line) => line.includes('Set this as SIFT_KEY')) + 1]).toMatch(/^[\w-]{43}$/);

    // A finished setup without one lists it, and makes one when picked; with one set it is never replaced.
    const later = wizard([], { client: true, accounts: ['me@example.org'], change: KEY_STEP });
    await runInit(later.deps);
    expect(later.text()).toContain('Encryption key: none, credentials stored plain');
    expect(later.calls).toEqual(['save key']);

    const set = wizard([], { client: true, accounts: ['me@example.org'], key: 'key-a', change: KEY_STEP });
    await runInit(set.deps);
    expect(set.text()).toContain(`Encryption key: Credentials encrypted · key ${set.config.keys.current!.id}`);
    expect(set.text()).toContain('SIFT_OLD_KEYS');
    expect(set.calls).toEqual([]);
  });

  it('leaves Sentry out of the walk-through, and sets or clears its DSN when it is picked', async () => {
    const first = wizard([...GOOGLE]);
    await runInit(first.deps);
    expect(first.asked).not.toContain('Sentry DSN (empty for none):');

    const dsn = 'https://key@o1.ingest.example.org/2';
    const set = wizard(['not a dsn', dsn], { client: true, accounts: ['me@example.org'], change: SENTRY_STEP });
    await runInit(set.deps);
    expect(set.text()).toContain('Sentry: off');
    expect(set.text()).toContain('fail: SENTRY_DSN must be a Sentry DSN');
    expect(set.text()).toContain('ok: Sent to o1.ingest.example.org from the next start');
    expect(parseEnv(readFileSync(set.config.envPath, 'utf8'))).toEqual({ SENTRY_DSN: dsn });

    const cleared = wizard([''], { client: true, accounts: ['me@example.org'], change: SENTRY_STEP });
    saveSetting(cleared.config, 'SENTRY_DSN', dsn);
    await runInit(cleared.deps);
    expect(cleared.text()).toContain('Sentry: Errors and traces sent · o1.ingest.example.org');
    expect(parseEnv(readFileSync(cleared.config.envPath, 'utf8'))).toEqual({});
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
    expect(server.config.settings.url).toBe('https://box.example.ts.net');
    expect(server.text()).toContain('ok: Dashboard at');
    expect(server.text()).toContain('https://box.example.ts.net');

    const google = wizard([1, 0, ...GOOGLE], { location: 'ask' });
    await runInit(google.deps);
    expect(google.text()).toContain('https://box.example.ts.net/auth/callback');

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
});

describe('settings', () => {
  it('defaults to ~/.config/sift and honours XDG_CONFIG_HOME and SIFT_HOME', () => {
    expect(resolveHome({ HOME: '/home/u' })).toMatch(/\/\.config\/sift$/);
    expect(resolveHome({ XDG_CONFIG_HOME: '/x' })).toBe('/x/sift');
    expect(resolveHome({ SIFT_HOME: '/data', XDG_CONFIG_HOME: '/x' })).toBe('/data');
  });

  it('keeps everything in the home directory and needs no environment variables', () => {
    const home = tempDir();
    const config = loadConfig({ SIFT_HOME: home });
    for (const path of [config.envPath, config.databaseDir, config.googleClientPath]) {
      expect(path.startsWith(`${home}/`)).toBe(true);
    }
    expect(config.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("writes one setting at a time to the home's .env, keeping every other line", () => {
    const config = loadConfig({ SIFT_HOME: tempDir() });
    writeFileSync(config.envPath, 'SIFT_OLD_KEYS=old\nSIFT_DASHBOARD_PORT=9000\n');
    saveSetting(config, 'SIFT_DASHBOARD_PORT', '9100');
    saveSetting(config, 'SIFT_URL', 'https://box.example.ts.net');
    expect(saved(config)).toEqual({ ...DEFAULT_SETTINGS, dashboardPort: 9100, url: 'https://box.example.ts.net' });
    expect(config.settings).toEqual(saved(config));
    saveSetting(config, 'SIFT_URL', undefined);
    expect(readFileSync(config.envPath, 'utf8')).toBe('SIFT_OLD_KEYS=old\nSIFT_DASHBOARD_PORT=9100\n');
  });

  it('refuses a wrong value by the variable that gave it', () => {
    expect(() => readSettings({ SIFT_DASHBOARD_PORT: '0' })).toThrow('SIFT_DASHBOARD_PORT must be a port number.');
    expect(() => readSettings({ SIFT_DASHBOARD_PORT: 'soon' })).toThrow('SIFT_DASHBOARD_PORT must be a port number.');
    for (const url of ['box.example.ts.net', 'ftp://box.example.ts.net', 'https://box.example.ts.net/sift', 'https://me@box.example.ts.net']) {
      expect(() => readSettings({ SIFT_URL: url })).toThrow('SIFT_URL must be an address starting https:// or http://, with no path.');
    }
    expect(readSettings({ SIFT_URL: 'https://Box.example.ts.net/' }).url).toBe('https://box.example.ts.net');
    expect(() => readSettings({ DATABASE_URL: 'mysql://x' })).toThrow('DATABASE_URL must be an address starting postgres://');
    expect(() => readSettings({ REDIS_URL: 'http://x' })).toThrow('REDIS_URL must be an address starting redis:// or rediss://');
    expect(() => readSettings({ SIFT_CHATGPT_SIGN_IN: 'on' })).toThrow('SIFT_CHATGPT_SIGN_IN must be "device-code" or "redirect".');
    expect(readSettings({ SIFT_CHATGPT_SIGN_IN: 'redirect', SIFT_DASHBOARD_PORT: '' }).chatgptSignIn).toBe('redirect');
    expect(() => readSettings({ SIFT_CLOUD: 'yes' })).toThrow('SIFT_CLOUD must be true or false.');
    expect(readSettings({ SIFT_CLOUD: 'true' }).cloud).toBe(true);
    expect(readSettings({ SIFT_CLOUD: 'false' }).cloud).toBe(false);
  });

  it('installs a pasted Web application client, or one given as a path, and refuses a Desktop one', () => {
    const config = loadConfig({ SIFT_HOME: tempDir() });
    const web = JSON.stringify({ web: { client_id: 'id', client_secret: 'secret' } }, null, 2);
    const desktop = JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } });

    expect(() => installClient(config, JSON.stringify({ other: {} }))).toThrow('not a Google OAuth client');
    expect(() => installClient(config, '{"web": ')).toThrow('not valid JSON');
    expect(() => loadClientSecrets(config, {})).toThrow('Run `sift init`');

    installClient(config, `  ${web}\n`);
    expect(loadClientSecrets(config, {})).toEqual({ clientId: 'id', clientSecret: 'secret' });

    const other = loadConfig({ SIFT_HOME: tempDir() });
    const file = join(tempDir(), 'client.json');
    writeFileSync(file, web);
    installClient(other, file);
    expect(loadClientSecrets(other, {}).clientId).toBe('id');

    expect(() => installClient(other, desktop)).toThrow('Desktop app client');
    writeFileSync(other.googleClientPath, desktop);
    expect(() => loadClientSecrets(other, {})).toThrow('needs a Web application one');
  });
});

describe('settings from the environment', () => {
  const DATABASE = {
    DATABASE_URL: 'postgres://app:app-secret@db.example.com/sift',
    DATABASE_MIGRATION_URL: 'postgres://owner:owner-secret@db.example.com/sift',
  };

  it('are read from their variables', () => {
    const config = loadConfig({ SIFT_HOME: tempDir(), SIFT_DASHBOARD_PORT: '9100', ...DATABASE });
    expect(config.settings).toMatchObject({ dashboardPort: 9100 });
    expect([config.databaseUrl, config.databaseMigrationUrl]).toEqual([DATABASE.DATABASE_URL, DATABASE.DATABASE_MIGRATION_URL]);
  });

  it("never copies one into the home's .env when another is saved", () => {
    const config = loadConfig({ SIFT_HOME: tempDir(), ...DATABASE });
    saveSetting(config, 'SIFT_URL', 'https://box.example.ts.net');
    expect(readFileSync(config.envPath, 'utf8')).toBe('SIFT_URL=https://box.example.ts.net\n');
    expect(config.settings.databaseUrl).toBe(DATABASE.DATABASE_URL);
  });
});

/** The settings the home's .env holds. */
const saved = (config: Config) => readSettings(parseEnv(readFileSync(config.envPath, 'utf8')));
