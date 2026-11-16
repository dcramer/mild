import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Keyring, loadKeyring } from './secrets.ts';

/**
 * What a deploy must say, each in its environment variable (`ENVIRONMENT`). Locally they can sit in the
 * home directory's `.env`, which sift reads when it starts; a variable already set wins.
 */
export interface Settings {
  dashboardPort: number;
  /**
   * Where the dashboard listens besides localhost, when sift runs on a server: one of this machine's
   * addresses or names, or `all` for every network it is on. Unset: this machine only.
   */
  dashboardHost?: string;
  /** A Postgres server's address. Unset: PGlite, in the home directory. */
  databaseUrl?: string;
  /**
   * The same server as the role that owns the tables, for migrating them: sift migrates with it and
   * then runs as `databaseUrl`, which then needs to own nothing. Unset: `databaseUrl` migrates too.
   */
  databaseMigrationUrl?: string;
  /**
   * A Redis server for what sift keeps only briefly (sign-ins in progress, which pass holds a mailbox,
   * Gmail quota). Unset: kept in this process's memory, which holds only while one `sift run` is running.
   */
  redisUrl?: string;
  /**
   * How people sign in to ChatGPT. `device-code` (the default) enters a code at OpenAI and reaches
   * ChatGPT through Codex's backend. `redirect` is OpenAI's Sign in with ChatGPT, on the documented API:
   * its sign-in can only return to 127.0.0.1 on the person's own machine, so on a server they paste the
   * address of the page that fails to load. Switching signs everyone out of ChatGPT.
   */
  chatgptSignIn?: 'device-code' | 'redirect';
}

/** Each setting's variable, and what its text must be. Hosts that run sift for you (Vercel) configure it only this way. */
const ENVIRONMENT = {
  SIFT_DASHBOARD_PORT: 'dashboardPort',
  SIFT_DASHBOARD_HOST: 'dashboardHost',
  DATABASE_URL: 'databaseUrl',
  DATABASE_MIGRATION_URL: 'databaseMigrationUrl',
  REDIS_URL: 'redisUrl',
  SIFT_CHATGPT_SIGN_IN: 'chatgptSignIn',
} as const satisfies Record<string, keyof Settings>;
export type Variable = keyof typeof ENVIRONMENT;

export const DEFAULT_SETTINGS: Settings = { dashboardPort: 8787 };

/**
 * Everything sift keeps lives in one directory, the home: settings, guidance, the database and
 * credentials. Back it up or move it as a unit.
 */
export interface Config {
  home: string;
  /** The home's `.env`: settings, and anything else to set when sift starts there. */
  envPath: string;
  /** Where PGlite keeps the database, when no Postgres server is given. */
  databaseDir: string;
  /** A Postgres server to use instead: `DATABASE_URL`. */
  databaseUrl: string | undefined;
  /** The address to migrate it with, when that is another role's. */
  databaseMigrationUrl: string | undefined;
  /** The user's own Google OAuth client, as downloaded from Google Cloud Console. */
  googleClientPath: string;
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
  const settings = readSettings(env);
  return {
    home,
    envPath: join(home, '.env'),
    databaseDir: join(home, 'database'),
    databaseUrl: settings.databaseUrl,
    databaseMigrationUrl: settings.databaseMigrationUrl,
    googleClientPath: join(home, 'google-client.json'),
    setupStatePath: join(home, 'setup.json'),
    dashboardKeyPath: join(home, 'dashboard-key'),
    keys: loadKeyring(env),
    settings,
  };
}

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

/** The settings the environment gives, each checked: a wrong value is an error that names its variable. */
export function readSettings(env: NodeJS.ProcessEnv): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const bad = (variable: Variable, expected: string) => new Error(`${variable} must be ${expected}.`);
  for (const variable of Object.keys(ENVIRONMENT) as Variable[]) {
    const text = env[variable]?.trim();
    if (!text) continue;
    switch (variable) {
      case 'SIFT_DASHBOARD_PORT': {
        const port = Number(text);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad(variable, 'a port number');
        settings.dashboardPort = port;
        break;
      }
      case 'SIFT_DASHBOARD_HOST':
        if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(text)) throw bad(variable, 'a hostname or IP address');
        settings.dashboardHost = text === '0.0.0.0' ? 'all' : text;
        break;
      case 'DATABASE_URL':
      case 'DATABASE_MIGRATION_URL':
        if (!/^postgres(ql)?:\/\//.test(text)) throw bad(variable, 'an address starting postgres://');
        if (variable === 'DATABASE_URL') settings.databaseUrl = text;
        else settings.databaseMigrationUrl = text;
        break;
      case 'REDIS_URL':
        if (!/^rediss?:\/\//.test(text)) throw bad(variable, 'an address starting redis:// or rediss://');
        settings.redisUrl = text;
        break;
      case 'SIFT_CHATGPT_SIGN_IN':
        if (text !== 'device-code' && text !== 'redirect') throw bad(variable, '"device-code" or "redirect"');
        settings.chatgptSignIn = text;
        break;
    }
  }
  return settings;
}

/**
 * Set one setting in the home's `.env`, or take it out, keeping every other line; and in `config`. A
 * variable set in the environment still wins over the file when sift next starts.
 */
export function saveSetting(config: Config, variable: Variable, value: string | undefined): void {
  const before = existsSync(config.envPath) ? readFileSync(config.envPath, 'utf8').split('\n') : [];
  const kept = before.filter((line) => line !== '' && !line.startsWith(`${variable}=`));
  writeFileSync(config.envPath, [...kept, ...(value === undefined ? [] : [`${variable}=${value}`])].map((line) => `${line}\n`).join(''), { mode: 0o600 });
  chmodSync(config.envPath, 0o600);
  const given: NodeJS.ProcessEnv = {};
  for (const name of Object.keys(ENVIRONMENT) as Variable[]) {
    const current = settingText(config.settings, name);
    if (current !== undefined) given[name] = current;
  }
  if (value === undefined) delete given[variable];
  else given[variable] = value;
  config.settings = readSettings(given);
}

/** A setting as its variable's text. */
function settingText(settings: Settings, variable: Variable): string | undefined {
  const value = settings[ENVIRONMENT[variable]];
  return value === undefined ? undefined : Array.isArray(value) ? value.join(',') : String(value);
}
