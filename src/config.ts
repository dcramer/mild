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
  /** Seconds between passes. */
  interval: number;
  dashboardPort: number;
  /**
   * The name or address other machines use to reach the dashboard, when sift runs on a server. The
   * dashboard then listens there as well as on localhost, and sift prints URLs with it. Unset: this machine only.
   */
  dashboardHost?: string;
}

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
          settings.dashboardHost = port;
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

# Seconds between checks for new mail.
interval = ${settings.interval}

[dashboard]
port = ${settings.dashboardPort}
# The name or address other machines reach this one by (a Tailscale address, say). The dashboard then
# listens there too. It has no login: anyone who can reach that address can read it. Unset: localhost only.
${settings.dashboardHost ? `host = ${JSON.stringify(settings.dashboardHost)}` : '# host = "100.x.y.z"'}
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

/** Where to point a browser for the dashboard. */
export const dashboardUrl = (settings: Settings) => `http://${settings.dashboardHost ?? 'localhost'}:${settings.dashboardPort}`;
