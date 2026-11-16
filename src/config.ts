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
  /** The user's broad guidance for triage, in plain language. */
  guidelinesPath: string;
  /** Who the people are and which mailboxes are whose. */
  dbPath: string;
  /** One database per person, `<user id>.db`. */
  usersDir: string;
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
    usersDir: join(home, 'users'),
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
  return `# Chosen in the dashboard, under Settings, or with \`sift init\`. Unset: mail no rule or learned sender covers stays in your inbox.
${settings.model ? `model = ${JSON.stringify(settings.model)}` : '# model = "provider/model-id"'}

# false: record what sift would do. true: carry it out in Gmail (each change can be undone in the dashboard).
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

export function saveSettings(config: Config, settings: Settings): void {
  writeFileSync(config.settingsPath, renderSettings(settings), { mode: 0o600 });
  chmodSync(config.settingsPath, 0o600);
  config.settings = settings;
}

/**
 * What `guidelines.md` starts as. The model reads all of it as the owner's instructions, so it holds only
 * instructions: they name the default labels (src/store/labels.ts) and lean towards leaving mail in the inbox.
 */
export const GUIDELINES_TEMPLATE = `# Guidelines for sift

- When in doubt, keep it in my inbox. If you are not sure what a message is, say you are unsure. I would rather read one message too many than miss one that mattered.
- Anything a person wrote to me, or to a small group I am part of, is Personal, however short or oddly written. So is a reply in a conversation I took part in.
- Anything about my money, my accounts or something I have to do by a date stays in my inbox: bills, renewals, failed payments, deliveries, bookings, tax, legal and security notices. A company's receipts are not Marketing because its promotions are.
- Marketing and Newsletters are only for mail sent to a whole list. Mail from a company about me in particular (my order, my account, my support request) is neither.
- Cold outreach is a pitch from someone I have no history with. If I have written to them, or they are answering me, it is Personal.
- A real notice about my own account is Security and account, however alarming. It is Phishing only when the sender is not who they claim to be.
- Junk is for mail that is deceptive or that I could never have signed up for. Unwanted mail from a real company is Marketing.
`;
