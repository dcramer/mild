import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';

/** What the user chooses, kept in `sift.toml`. Nothing here is required to be set through the environment. */
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
}

export const DEFAULT_SETTINGS: Settings = { act: false, heuristics: false, interval: 60, dashboardPort: 8787 };

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
    settings: existsSync(settingsPath) ? parseSettings(readFileSync(settingsPath, 'utf8'), settingsPath) : { ...DEFAULT_SETTINGS },
  };
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
        } else throw new Error(`${path}: unknown setting dashboard.${sub}.`);
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

# true: mail that is plainly bulk by its headers (a mailing list with a one-click unsubscribe, sent through
# a bulk mail service, from a sender you have never written to) is labelled Marketing or Newsletters
# without asking the model. Anything less clear still goes to the model.
heuristics = ${settings.heuristics}

# Seconds between checks for new mail.
interval = ${settings.interval}

[dashboard]
port = ${settings.dashboardPort}
# Where else the dashboard listens: one of this machine's addresses (a Tailscale one, say), or "all" for
# every network it is on. It has no login: anyone who can reach it there can read it. Unset: localhost only.
${settings.dashboardHost ? `host = ${JSON.stringify(settings.dashboardHost)}` : '# host = "all"'}
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
