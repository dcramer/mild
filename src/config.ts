import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import { type Keyring, loadKeyring } from './secrets.ts';

/** What the user chooses, kept in `sift.toml`. None of it is set through the environment; only the encryption key is. */
export interface Settings {
  /** `provider/model-id` for mail no rule or learned sender covers. Unset keeps the model tier off. */
  model?: string;
  /** false: record what sift would do. true: carry decisions out in Gmail. */
  act: boolean;
  /** Seconds between passes. */
  interval: number;
  dashboardPort: number;
  /**
   * Where the dashboard listens besides localhost, when sift runs on a server: one of this machine's
   * addresses or names, or `all` for every network it is on. Unset: this machine only.
   */
  dashboardHost?: string;
  /** Days to keep the record of a message, its decisions and changes. Unset: forever. */
  retentionDays?: number;
}

/** Shorter, and sync's 7-day recovery search could bring back a message already forgotten and decide it twice. */
const MIN_RETENTION_DAYS = 30;

export const DEFAULT_SETTINGS: Settings = { act: false, interval: 60, dashboardPort: 8787 };

/**
 * Everything sift keeps lives in one directory, the home: settings, guidance, the database and
 * credentials. Back it up or move it as a unit.
 */
export interface Config {
  home: string;
  /** `sift.toml`. */
  settingsPath: string;
  /** The user's broad guidance for triage, in plain language. */
  guidelinesPath: string;
  dbPath: string;
  /** The user's own Google OAuth client, as downloaded from Google Cloud Console. */
  googleClientPath: string;
  /** One refresh token per connected account. */
  googleTokenDir: string;
  /** Model provider credentials (API keys, OAuth tokens). */
  modelAuthPath: string;
  deviceIdPath: string;
  /** How far `sift init` has got. */
  setupStatePath: string;
  /** The secret in the dashboard's access link. */
  dashboardKeyPath: string;
  /** From `SIFT_KEY` and `SIFT_OLD_KEYS`: what the credentials above are encrypted with. */
  keys: Keyring;
  settings: Settings;
}

/**
 * Where the home is: `--home` or SIFT_HOME if given (containers use this), otherwise
 * `$XDG_CONFIG_HOME/sift`, which is `~/.config/sift` by default.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env['SIFT_HOME']) return resolve(env['SIFT_HOME']);
  return join(env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'sift');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = resolveHome(env);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const settingsPath = join(home, 'sift.toml');
  return {
    home,
    settingsPath,
    guidelinesPath: join(home, 'guidelines.md'),
    dbPath: join(home, 'sift.db'),
    googleClientPath: join(home, 'google-client.json'),
    googleTokenDir: join(home, 'google'),
    modelAuthPath: join(home, 'model-auth.json'),
    deviceIdPath: join(home, 'device-id'),
    setupStatePath: join(home, 'setup.json'),
    dashboardKeyPath: join(home, 'dashboard-key'),
    keys: loadKeyring(env),
    settings: existsSync(settingsPath) ? parseSettings(readFileSync(settingsPath, 'utf8'), settingsPath) : { ...DEFAULT_SETTINGS },
  };
}

/**
 * Read `.env` from the home directory, then from the working directory. A variable already set is never
 * replaced, so the real environment wins, then the home's file.
 */
export function loadEnvFiles(home: string, cwd: string = process.cwd()): void {
  for (const path of new Set([join(home, '.env'), join(cwd, '.env')])) if (existsSync(path)) process.loadEnvFile(path);
}

/** Every file that holds a credential, for checking and re-encrypting them together. */
export function secretPaths(config: Config): string[] {
  const tokens = existsSync(config.googleTokenDir) ? readdirSync(config.googleTokenDir).filter((f) => f.endsWith('.json')) : [];
  return [config.googleClientPath, ...tokens.map((f) => join(config.googleTokenDir, f)), config.modelAuthPath, config.dashboardKeyPath];
}

/** Parse `sift.toml`. Unknown keys and wrong types are errors, so a typo is not silently ignored. */
export function parseSettings(text: string, path = 'sift.toml'): Settings {
  let raw: Record<string, unknown>;
  try {
    raw = parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid TOML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, { cause: error });
  }
  const bad = (key: string, expected: string) => new Error(`${path}: ${key} must be ${expected}.`);
  const settings: Settings = { ...DEFAULT_SETTINGS };

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'model') {
      if (typeof value !== 'string' || !/^[^/\s]+\/\S+$/.test(value)) throw bad('model', 'a string like "provider/model-id"');
      settings.model = value;
    } else if (key === 'act') {
      if (typeof value !== 'boolean') throw bad('act', 'true or false');
      settings.act = value;
    } else if (key === 'interval') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 5) throw bad('interval', 'a number of seconds, at least 5');
      settings.interval = value;
    } else if (key === 'dashboard') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('dashboard', 'a table');
      for (const [sub, port] of Object.entries(value as Record<string, unknown>)) {
        if (sub === 'port') {
          if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw bad('dashboard.port', 'a port number');
          settings.dashboardPort = port;
        } else if (sub === 'host') {
          if (typeof port !== 'string' || !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(port)) throw bad('dashboard.host', 'a hostname or IP address');
          settings.dashboardHost = port === '0.0.0.0' ? 'all' : port;
        } else throw new Error(`${path}: unknown setting dashboard.${sub}.`);
      }
    } else if (key === 'retention') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('retention', 'a table');
      for (const [sub, days] of Object.entries(value as Record<string, unknown>)) {
        if (sub !== 'days') throw new Error(`${path}: unknown setting retention.${sub}.`);
        if (typeof days !== 'number' || !Number.isInteger(days) || days < MIN_RETENTION_DAYS)
          throw bad('retention.days', `a whole number of days, at least ${MIN_RETENTION_DAYS}`);
        settings.retentionDays = days;
      }
    } else {
      throw new Error(`${path}: unknown setting ${key}.`);
    }
  }
  return settings;
}

/** `sift.toml` with every setting and what it does. The comments are sift's; hand edits to values are kept. */
export function renderSettings(settings: Settings): string {
  return `# \`sift models\` lists what you can use. Unset: mail no rule or learned sender covers stays in your inbox.
${settings.model ? `model = ${JSON.stringify(settings.model)}` : '# model = "provider/model-id"'}

# false: record what sift would do. true: carry it out in Gmail (reversible with \`sift undo\`).
act = ${settings.act}

# Seconds between checks for new mail.
interval = ${settings.interval}

[dashboard]
port = ${settings.dashboardPort}
# Where else the dashboard listens: one of this machine's addresses (a Tailscale one, say), or "all" for
# every network it is on. It has no login: anyone who can reach it there can read it. Unset: localhost only.
${settings.dashboardHost ? `host = ${JSON.stringify(settings.dashboardHost)}` : '# host = "all"'}

[retention]
# Days to keep the record of a message, its decisions and changes, counted from the last thing that happened
# to it. After that the change can no longer be undone from sift. Suggestions still waiting on you, mail you
# answered for and what sift learned are kept regardless. Unset: keep everything.
${settings.retentionDays ? `days = ${settings.retentionDays}` : '# days = 365'}
`;
}

export function saveSettings(config: Config, settings: Settings): void {
  writeFileSync(config.settingsPath, renderSettings(settings), { mode: 0o600 });
  chmodSync(config.settingsPath, 0o600);
  config.settings = settings;
}

export const GUIDELINES_TEMPLATE = `# Guidelines for sift

The model reads this before sorting each message. Replace these examples with your own:

- Mail from recruiters is cold outreach, even when it sounds personal.
- Anything from my accountant or my bank is personal, not a notification.
- I read the Example Weekly newsletter; treat it as personal.
`;
