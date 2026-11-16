import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import { type Keyring, loadKeyring } from './secrets.ts';

/** What the user chooses: in `sift.toml`, or each in its environment variable (`ENVIRONMENT`), which wins. */
export interface Settings {
  /** false: record what sift would do. true: carry decisions out in Gmail. */
  act: boolean;
  /** true: mail that is plainly bulk by its headers is labelled before any model is asked. */
  heuristics: boolean;
  /** Seconds between passes. */
  interval: number;
  dashboardPort: number;
  /**
   * Where the dashboard listens besides localhost, when sift runs on a server: one of this machine's
   * addresses or names, or `all` for every network it is on. Unset: this machine only.
   */
  dashboardHost?: string;
  /**
   * The only Google accounts that may sign in to the dashboard, and so the only ones that can be connected.
   * Unset: the first account to sign in connects itself, and after that only connected accounts can.
   * A listed account that signs in by itself is a person of their own, and sees only their own mail.
   */
  dashboardAllow?: string[];
  /** Days to keep the record of a message, its decisions and changes. Unset: forever. */
  retentionDays?: number;
  /** Show the model a few messages the user labelled before, chosen for the message it is judging. */
  fewShot: boolean;
  /** Delete an example this many days after the user answered for it. Unset: examples are kept. */
  examplesKeepDays?: number;
  /** A Postgres server's address. Unset: PGlite, in the home directory. */
  databaseUrl?: string;
  /**
   * The same server as the role that owns the tables, for migrating them: sift migrates with it and
   * then runs as `databaseUrl`, which then needs to own nothing. Unset: `databaseUrl` migrates too.
   */
  databaseMigrationUrl?: string;
}

/**
 * Each setting's variable, where it goes in `sift.toml`, and how its text is read. Hosts that run sift
 * for you (Vercel, Cloudflare) configure it only this way.
 */
export const ENVIRONMENT = {
  SIFT_ACT: { setting: 'act', key: ['act'], as: 'boolean' },
  SIFT_HEURISTICS: { setting: 'heuristics', key: ['heuristics'], as: 'boolean' },
  SIFT_INTERVAL: { setting: 'interval', key: ['interval'], as: 'number' },
  SIFT_DASHBOARD_PORT: { setting: 'dashboardPort', key: ['dashboard', 'port'], as: 'number' },
  SIFT_DASHBOARD_HOST: { setting: 'dashboardHost', key: ['dashboard', 'host'], as: 'string' },
  SIFT_DASHBOARD_ALLOW: { setting: 'dashboardAllow', key: ['dashboard', 'allow'], as: 'list' },
  SIFT_RETENTION_DAYS: { setting: 'retentionDays', key: ['retention', 'days'], as: 'number' },
  SIFT_FEW_SHOT: { setting: 'fewShot', key: ['examples', 'few_shot'], as: 'boolean' },
  SIFT_EXAMPLES_KEEP_DAYS: { setting: 'examplesKeepDays', key: ['examples', 'keep_days'], as: 'number' },
  DATABASE_URL: { setting: 'databaseUrl', key: ['database', 'url'], as: 'string' },
  DATABASE_MIGRATION_URL: { setting: 'databaseMigrationUrl', key: ['database', 'migration_url'], as: 'string' },
} as const satisfies Record<string, { setting: keyof Settings; key: readonly string[]; as: 'boolean' | 'number' | 'string' | 'list' }>;
type Variable = keyof typeof ENVIRONMENT;

/** Text that is not what its setting takes is left as text, so the setting's own check refuses it by name. */
function fromText(text: string, as: 'boolean' | 'number' | 'string' | 'list'): unknown {
  if (as === 'boolean') return text === 'true' ? true : text === 'false' ? false : text;
  if (as === 'number') return text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
  if (as === 'list') return text.split(',').map((item) => item.trim());
  return text;
}

/** Shorter, and sync's 7-day recovery search could bring back a message already forgotten and decide it twice. */
const MIN_RETENTION_DAYS = 30;

export const DEFAULT_SETTINGS: Settings = { act: false, heuristics: false, interval: 60, dashboardPort: 8787, fewShot: true };

/**
 * Everything sift keeps lives in one directory, the home: settings, guidance, the database and
 * credentials. Back it up or move it as a unit.
 */
export interface Config {
  home: string;
  /** `sift.toml`. */
  settingsPath: string;
  /** Where PGlite keeps the database, when no Postgres server is given. */
  databaseDir: string;
  /** A Postgres server to use instead: `DATABASE_URL`, or `database.url` in `sift.toml`. */
  databaseUrl: string | undefined;
  /** The address to migrate it with, when that is another role's. */
  databaseMigrationUrl: string | undefined;
  /** The user's own Google OAuth client, as downloaded from Google Cloud Console. */
  googleClientPath: string;
  deviceIdPath: string;
  /** How far `sift init` has got. */
  setupStatePath: string;
  /** The secret in the dashboard's access link. */
  dashboardKeyPath: string;
  /** From `SIFT_KEY` and `SIFT_OLD_KEYS`: what the credentials above are encrypted with. */
  keys: Keyring;
  /** In effect: `sift.toml` with the environment over it. */
  settings: Settings;
  /** Which settings the environment gives, by the variable that gives each. The dashboard cannot change those. */
  environment: Partial<Record<keyof Settings, Variable>>;
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
  const file = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
  const environment: Config['environment'] = {};
  const given: [string[], unknown][] = [];
  for (const [variable, { setting, key, as }] of Object.entries(ENVIRONMENT) as [Variable, (typeof ENVIRONMENT)[Variable]][]) {
    const text = env[variable];
    if (text === undefined || text === '') continue;
    environment[setting] = variable;
    given.push([[...key], fromText(text, as)]);
  }
  const settings = parseSettings(file, settingsPath, given);
  return {
    home,
    settingsPath,
    databaseDir: join(home, 'database'),
    databaseUrl: settings.databaseUrl,
    databaseMigrationUrl: settings.databaseMigrationUrl,
    googleClientPath: join(home, 'google-client.json'),
    deviceIdPath: join(home, 'device-id'),
    setupStatePath: join(home, 'setup.json'),
    dashboardKeyPath: join(home, 'dashboard-key'),
    keys: loadKeyring(env),
    settings,
    environment,
  };
}

export const isAddress = (value: string) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value);
/**
 * Read `.env` from the home directory, then from the working directory. A variable already set is never
 * replaced, so the real environment wins, then the home's file.
 */
export function loadEnvFiles(home: string, cwd: string = process.cwd()): void {
  for (const path of new Set([join(home, '.env'), join(cwd, '.env')])) if (existsSync(path)) process.loadEnvFile(path);
}

/** Add `SIFT_KEY` to the `.env` in `dir`, keeping what the file already holds, and make it owner-only. Returns its path. */
export function saveKeyFile(dir: string, key: string): string {
  const path = join(dir, '.env');
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeFileSync(path, `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}SIFT_KEY=${key}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Every file that holds a credential, for checking and re-encrypting them together. People's sign-ins are in their databases. */
export function secretPaths(config: Config): string[] {
  return [config.googleClientPath, config.dashboardKeyPath];
}

/**
 * Parse `sift.toml`, with `environment` (each a `sift.toml` key and its value) over it. Unknown keys and
 * wrong types are errors, so a typo is not silently ignored; an error names the variable when the value
 * came from one.
 */
export function parseSettings(text: string, path = 'sift.toml', environment: readonly [string[], unknown][] = []): Settings {
  let raw: Record<string, unknown>;
  try {
    raw = parse(text);
  } catch (error) {
    throw new Error(`${path} is not valid TOML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, { cause: error });
  }
  const fromEnvironment = new Set<string>();
  for (const [key, value] of environment) {
    let table = raw;
    for (const part of key.slice(0, -1)) {
      const inner = table[part];
      table = (table[part] = typeof inner === 'object' && inner !== null && !Array.isArray(inner) ? inner : {}) as Record<string, unknown>;
    }
    table[key.at(-1)!] = value;
    fromEnvironment.add(key.join('.'));
  }
  const variable = (key: string) => Object.entries(ENVIRONMENT).find(([, v]) => v.key.join('.') === key)?.[0];
  const bad = (key: string, expected: string) =>
    new Error(fromEnvironment.has(key) ? `${variable(key)} must be ${expected}.` : `${path}: ${key} must be ${expected}.`);
  const settings: Settings = { ...DEFAULT_SETTINGS };

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'model') throw new Error(`${path}: the model is now each person's own, chosen in the dashboard under Settings. Remove model from here.`);
    else if (key === 'act') {
      if (typeof value !== 'boolean') throw bad('act', 'true or false');
      settings.act = value;
    } else if (key === 'heuristics') {
      if (typeof value !== 'boolean') throw bad('heuristics', 'true or false');
      settings.heuristics = value;
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
        } else if (sub === 'allow') {
          // An empty list would lock everyone out; leaving the key out is how to have no limit.
          const list = Array.isArray(port) ? port.filter((address): address is string => typeof address === 'string' && isAddress(address)) : [];
          if (!Array.isArray(port) || list.length === 0 || list.length !== port.length) throw bad('dashboard.allow', 'a list of email addresses');
          settings.dashboardAllow = list.map((address) => address.toLowerCase());
        } else throw new Error(`${path}: unknown setting dashboard.${sub}.`);
      }
    } else if (key === 'database') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('database', 'a table');
      for (const [sub, url] of Object.entries(value as Record<string, unknown>)) {
        if (sub !== 'url' && sub !== 'migration_url') throw new Error(`${path}: unknown setting database.${sub}.`);
        if (typeof url !== 'string' || !/^postgres(ql)?:\/\//.test(url)) throw bad(`database.${sub}`, 'an address starting postgres://');
        if (sub === 'url') settings.databaseUrl = url;
        else settings.databaseMigrationUrl = url;
      }
    } else if (key === 'retention') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('retention', 'a table');
      for (const [sub, days] of Object.entries(value as Record<string, unknown>)) {
        if (sub !== 'days') throw new Error(`${path}: unknown setting retention.${sub}.`);
        if (typeof days !== 'number' || !Number.isInteger(days) || days < MIN_RETENTION_DAYS)
          throw bad('retention.days', `a whole number of days, at least ${MIN_RETENTION_DAYS}`);
        settings.retentionDays = days;
      }
    } else if (key === 'examples') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('examples', 'a table');
      for (const [sub, given] of Object.entries(value as Record<string, unknown>)) {
        if (sub === 'few_shot') {
          if (typeof given !== 'boolean') throw bad('examples.few_shot', 'true or false');
          settings.fewShot = given;
        } else if (sub === 'keep_days') {
          if (typeof given !== 'number' || !Number.isInteger(given) || given < 1) throw bad('examples.keep_days', 'a whole number of days, at least 1');
          settings.examplesKeepDays = given;
        } else throw new Error(`${path}: unknown setting examples.${sub}.`);
      }
    } else {
      throw new Error(`${path}: unknown setting ${key}.`);
    }
  }
  return settings;
}

/** `sift.toml` with every setting and what it does. The comments are sift's; hand edits to values are kept. */
export function renderSettings(settings: Settings): string {
  return `# false: record what sift would do. true: carry it out in Gmail (each change can be undone in the dashboard).
act = ${settings.act}

# true: mail that is plainly bulk by its headers (a mailing list with a one-click unsubscribe, sent through
# a bulk mail service, from a sender you have never written to) is labelled Marketing or Newsletters
# without asking the model. Anything less clear still goes to the model.
heuristics = ${settings.heuristics}

# Seconds between checks for new mail.
interval = ${settings.interval}

[dashboard]
port = ${settings.dashboardPort}
# Where else the dashboard listens: one of this machine's addresses (a Tailscale one, say), or "all" for
# every network it is on. Unset: localhost only.
${settings.dashboardHost ? `host = ${JSON.stringify(settings.dashboardHost)}` : '# host = "all"'}
# The only Google accounts that may sign in. Each who signs in by themselves sees only their own mail;
# add a second mailbox of your own from Settings while signed in. Unset: the first to sign in connects itself, and after that
# only connected accounts can.
${settings.dashboardAllow ? `allow = ${JSON.stringify(settings.dashboardAllow)}` : '# allow = ["you@example.com"]'}

# A Postgres server to keep everything in. Unset: sift keeps it in this directory itself (PGlite).
# migration_url: the role that owns the tables, if sift should run as one that owns nothing.
${settings.databaseUrl ? `[database]\nurl = ${JSON.stringify(settings.databaseUrl)}\n${settings.databaseMigrationUrl ? `migration_url = ${JSON.stringify(settings.databaseMigrationUrl)}\n` : ''}` : '# [database]\n# url = "postgres://user:password@host/sift"\n'}
[retention]
# Days to keep the record of a message, its decisions and changes, counted from the last thing that happened
# to it. After that the change can no longer be undone from sift. Suggestions still waiting on you, mail you
# answered for and what sift learned are kept regardless. Unset: keep everything.
${settings.retentionDays ? `days = ${settings.retentionDays}` : '# days = 365'}

# Examples are the messages you answered for in the dashboard, kept whole.
[examples]
# true: the model is shown a few of them (sender, subject, the first lines, your label) beside each
# message it judges. It learns from your answers and each call costs a little more.
few_shot = ${settings.fewShot}
# Delete an example this many days after you answered for it. They hold the whole message. Unset: kept
# until you delete them in the dashboard.
${settings.examplesKeepDays ? `keep_days = ${settings.examplesKeepDays}` : '# keep_days = 365'}
`;
}

/**
 * Write `settings` to `sift.toml`. What the environment gives stays as the file had it, so a variable's
 * value (a database password, say) is never copied into the file.
 */
export function saveSettings(config: Config, settings: Settings): void {
  const file = existsSync(config.settingsPath) ? parseSettings(readFileSync(config.settingsPath, 'utf8'), config.settingsPath) : { ...DEFAULT_SETTINGS };
  const kept: Record<string, unknown> = { ...settings };
  for (const setting of Object.keys(config.environment) as (keyof Settings)[]) {
    if (file[setting] === undefined) delete kept[setting];
    else kept[setting] = file[setting];
  }
  writeFileSync(config.settingsPath, renderSettings(kept as unknown as Settings), { mode: 0o600 });
  chmodSync(config.settingsPath, 0o600);
  config.settings = settings;
}
