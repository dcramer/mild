#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { undo } from '../actions/executor.ts';
import { removeRuleFilter, writeRuleFilter } from '../actions/rule-filters.ts';
import { unsubscribe } from '../actions/unsubscribe.ts';
import { type Config, loadConfig, loadEnvFiles, resolveHome, saveKeyFile, saveSettings, secretPaths } from '../config.ts';
import { backfill } from '../daemon/backfill.ts';
import type { Activity, Controls, SignIn } from '../dashboard/controls.ts';
import { createDashboardServer } from '../dashboard/server.ts';
import { ensureWebBuilt } from './web-build.ts';
import { rejudgeWaiting } from '../daemon/rejudge.ts';
import { type PassResult, type Wake, createWake, runLoop, runOnce } from '../daemon/run.ts';
import { createGmailApi } from '../gmail/api.ts';
import { interruptEvals, startEval } from '../learn/evals.ts';
import { browserSignInUrl, clientFor, completeBrowserSignIn, hasClientSecrets, installClient, loadClientSecrets, saveRefreshToken } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { createJudge } from '../model/judge.ts';
import { login, openModels, resolveModel } from '../model/models.ts';
import { type Account, connectAccount, listAccounts } from '../store/accounts.ts';
import { getAction, lastStandingChange } from '../store/actions.ts';
import { loadKeyring, readSecret, rekeySecrets, writeSecret } from '../secrets.ts';
import { openDb } from '../store/db.ts';
import { type SetupState, runInit } from './init.ts';
import { signInRefusal } from './sign-in.ts';
import { listenAddresses, machineNames, tailscaleName } from './network.ts';
import { closeTerminal } from './terminal.ts';
import { paint, ui } from './ui.ts';
import { getRuleFilter } from '../store/filters.ts';

/** sift is set up and started from here; looking at and steering it happens in the dashboard. */
const MAIN_COMMANDS: readonly (readonly [string, string])[] = [
  ['init', 'Set sift up, or finish setting it up'],
  ['run', 'Sort your mail continuously, and serve the dashboard'],
  ['status', 'What is set up and how much sift has recorded'],
];
const OTHER_COMMANDS: readonly (readonly [string, string])[] = [
  ['dashboard', 'serve the dashboard without sorting mail'],
  ['dev', 'for working on sift: run, restarting and reloading as the code changes'],
];

function help(): void {
  ui.heading('sorts your Gmail inbox for you');
  const width = Math.max(...[...MAIN_COMMANDS, ...OTHER_COMMANDS].map(([name]) => name.length));
  for (const [name, what] of MAIN_COMMANDS) ui.plain(`${paint.cmd(`sift ${name.padEnd(width)}`)}  ${what}`);
  ui.blank();
  ui.info('Less often');
  for (const [name, what] of OTHER_COMMANDS) ui.plain(paint.dim(`sift ${name.padEnd(width)}  ${what}`));
  ui.blank();
  ui.info(paint.path(loadConfig().home));
  ui.blank();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Fails if a stored credential cannot be opened with the keys given. `rekey` also brings every one under
 * the current key. Returns what to tell the user once the heading is up.
 */
function checkSecrets(config: Config, rekey: boolean): () => void {
  const { encrypted, rotated } = rekeySecrets(secretPaths(config), config.keys, rekey);
  return () => {
    if (!config.keys.current) ui.warn(`Credentials are stored unencrypted. ${paint.cmd('sift init')} makes a key to encrypt them.`);
    if (!rekey) return;
    for (const path of encrypted) ui.ok(`Encrypted ${paint.path(path)}`);
    for (const path of rotated) ui.ok(`Re-encrypted ${paint.path(path)} with the current key`);
  };
}

function status(): void {
  const config = loadConfig();
  const secrets = checkSecrets(config, false);
  const db = openDb(config.dbPath);
  const accounts = listAccounts(db);
  const count = (table: string, where = '') => (db.prepare(`SELECT count(*) AS n FROM ${table} ${where}`).get() as { n: number }).n;
  const { settings } = config;
  const ready = hasClientSecrets(config) && accounts.length > 0;

  ui.heading('status', paint.path(config.home));
  ui.fields([
    ['Gmail', accounts.length > 0 ? accounts.map((a) => a.email).join(', ') : paint.dim(hasClientSecrets(config) ? 'not connected' : 'not set up')],
    ['Model', settings.model ?? paint.dim('none')],
    ['Mode', `${settings.act ? 'acting on decisions' : 'observing only'}${paint.dim(` · every ${settings.interval}s`)}`],
    ['Guidance', existsSync(config.guidelinesPath) ? paint.path(config.guidelinesPath) : paint.dim('none written')],
    ['Dashboard', signInAddresses(settings.dashboardPort).join(paint.dim('  or  '))],
  ]);
  ui.blank();
  const troubled = count('actions', `WHERE status IN ('failed', 'unknown', 'pending')`);
  ui.fields([
    ['Recorded', `${plural(count('messages'), 'message')} · ${plural(count('decisions'), 'decision')} · ${plural(count('actions'), 'change')}`],
    ['Rules', plural(count('rules'), 'rule')],
    ...(troubled > 0 ? [['Check', paint.bad(`${plural(troubled, 'change')} failed or unconfirmed; see Changes in the dashboard`)] as const] : []),
  ]);
  ui.blank();
  if (!ready) ui.warn(`Setup is not finished. Run ${paint.cmd('sift init')}.`);
  secrets();
  if (!ready || !config.keys.current) ui.blank();
  db.close();
}

async function init(): Promise<void> {
  const config = loadConfig();
  // Started away from the .env that holds the key, init would otherwise make a second one.
  checkSecrets(config, false);
  const models = openModels(config);
  const withDb = <T>(work: (db: ReturnType<typeof openDb>) => T): T => {
    const db = openDb(config.dbPath);
    try {
      return work(db);
    } finally {
      db.close();
    }
  };
  await runInit({
    config,
    ui,
    saveSettings: (settings) => saveSettings(config, settings),
    saveKey: (key) => {
      const path = saveKeyFile(process.cwd(), key);
      process.env['SIFT_KEY'] = key;
      // In place: the model credential store already holds this keyring.
      Object.assign(config.keys, loadKeyring());
      return path;
    },
    hasGoogleClient: () => hasClientSecrets(config),
    // A home set up before progress was recorded has a client and no state file: treat it as finished.
    setupState: () =>
      existsSync(config.setupStatePath)
        ? (JSON.parse(readFileSync(config.setupStatePath, 'utf8')) as SetupState)
        : hasClientSecrets(config)
          ? { googleTasks: 99, access: 'publish' }
          : { googleTasks: 0 },
    saveSetupState: (state) => writeFileSync(config.setupStatePath, JSON.stringify(state), { mode: 0o600 }),
    installGoogleClient: (json) => installClient(config, json),
    connectedAccounts: () => withDb((db) => listAccounts(db).map((a) => a.email)),
    loginModel: (choice) => login(models, config, choice.provider, choice.type, ui),
    availableModels: async (provider) => (await models.getAvailable(provider)).map((m) => m.id),
    googleClientKind: () => (hasClientSecrets(config) ? loadClientSecrets(config).kind : null),
    tailscaleName,
    enableTailscaleServe: async (servePort) => {
      let out: string;
      try {
        out = (await promisify(execFile)('tailscale', ['serve', '--bg', String(servePort)], { timeout: 20_000 })).stdout;
      } catch (error) {
        const detail = (error as { stderr?: string }).stderr?.trim().split('\n').at(-1);
        throw new Error(detail || 'tailscale serve did not start.', { cause: error });
      }
      // Tailscale exits 0 when serve is switched off for the tailnet, printing where to switch it on.
      if (/not enabled/i.test(out)) {
        const link = /https:\/\/\S+/.exec(out)?.[0];
        throw new Error(`Serve is off for your tailnet.${link ? ` Turn it on at ${link}` : ''}`);
      }
    },
  });
}

const mailboxFor = (config: Config, email: string) => createGmailMailbox(clientFor(config, loadClientSecrets(config), email));

/** The secret in the dashboard's access link, created the first time it is needed. */
function sessionSecret(config: Config): string {
  const stored = readSecret(config.dashboardKeyPath, config.keys);
  if (stored !== null) return stored.trim();
  const key = randomBytes(32).toString('base64url');
  writeSecret(config.dashboardKeyPath, key, config.keys);
  return key;
}

/** Addresses Google can sign someone in at: this machine, and its Tailscale name over HTTPS. */
function signInAddresses(port: number): string[] {
  const name = tailscaleName();
  return [`http://localhost:${port}`, ...(name ? [`https://${name}`] : [])];
}

/** Google sign-in from the dashboard: the same step connects the Gmail account and signs the viewer in. */
function buildSignIn(config: Config, db: ReturnType<typeof openDb>): SignIn {
  // Read each time, so a change to sift.toml applies without a restart.
  const allowed = () => loadConfig().settings.dashboardAllow;
  return {
    client: () => (hasClientSecrets(config) ? loadClientSecrets(config).kind : null),
    url: (redirectUri, state, challenge) => browserSignInUrl(loadClientSecrets(config), { redirectUri, state, challenge }),
    allowed: (email) => signInRefusal(email, { connected: [email], allowNew: false, allowed: allowed() }) === null,
    complete: async (redirectUri, code, verifier, allowNew) => {
      const { email, historyId, refreshToken } = await completeBrowserSignIn(loadClientSecrets(config), { redirectUri, code, verifier });
      const connected = listAccounts(db).map((a) => a.email);
      const refused = signInRefusal(email, { connected, allowNew, allowed: allowed() });
      if (refused) throw new Error(refused);
      saveRefreshToken(config, email, refreshToken);
      // A new account starts from now; a known one keeps its place.
      if (!connected.includes(email)) connectAccount(db, email, historyId);
      return email;
    },
  };
}

/** What the dashboard may ask this process to do. See `Controls`. */
function buildControls(config: Config, db: ReturnType<typeof openDb>, live: { wake?: Wake; activity: Activity }): Controls {
  const current = () => loadConfig().settings;
  interruptEvals(db);
  const guidelinesChangedAt = () => (existsSync(config.guidelinesPath) ? statSync(config.guidelinesPath).mtimeMs : null);
  let rejudging = false;
  return {
    settings: () => {
      const s = current();
      return { act: s.act, interval: s.interval, model: s.model ?? null, fewShot: s.fewShot, examplesKeepDays: s.examplesKeepDays ?? null };
    },
    saveSettings: (change) => {
      const { model: _old, examplesKeepDays: _kept, ...rest } = current();
      const model = change.model === undefined ? current().model : (change.model ?? undefined);
      const keepDays = change.examplesKeepDays === undefined ? current().examplesKeepDays : (change.examplesKeepDays ?? undefined);
      saveSettings(config, {
        ...rest,
        ...(change.act === undefined ? {} : { act: change.act }),
        ...(change.interval === undefined ? {} : { interval: change.interval }),
        ...(change.fewShot === undefined ? {} : { fewShot: change.fewShot }),
        ...(model ? { model } : {}),
        ...(keepDays ? { examplesKeepDays: keepDays } : {}),
      });
      live.wake?.now();
    },
    models: async () => (await openModels(config).getAvailable()).map((m) => `${m.provider}/${m.id}`),
    guidelines: () => (existsSync(config.guidelinesPath) ? readFileSync(config.guidelinesPath, 'utf8') : ''),
    saveGuidelines: (text) => {
      // Saving the same text must not make every waiting suggestion look out of date.
      if (existsSync(config.guidelinesPath) && readFileSync(config.guidelinesPath, 'utf8') === text) return;
      writeFileSync(config.guidelinesPath, text, { mode: 0o600 });
    },
    guidelinesChangedAt,
    rejudge: async (accountId) => {
      const spec = current().model;
      const account = listAccounts(db).find((a) => a.id === accountId);
      const since = guidelinesChangedAt();
      if (!spec) throw new Error('Choose a model first.');
      if (!account || since === null) return { started: 0, remaining: 0 };
      if (rejudging) throw new Error('Suggestions are already being judged again. Wait for that to finish.');
      const tier = await openModelTier(config, spec);
      const client = clientFor(config, loadClientSecrets(config), account.email);
      const model = {
        judge: tier.judge,
        guidelines: tier.guidelines(),
        fewShot: current().fewShot,
        sources: { api: createGmailApi(client), mailbox: createGmailMailbox(client) },
      };
      const { started, remaining, done } = rejudgeWaiting({ db, mailbox: null, model }, account, since);
      rejudging = true;
      void done.finally(() => (rejudging = false));
      return { started, remaining };
    },
    undo: async (actionId) => {
      const action = getAction(db, actionId);
      if (!action) throw new Error(`There is no change #${actionId}.`);
      const outcome = await undo({ db, mailbox: mailboxFor(config, action.accountId) }, actionId);
      if (outcome.status === 'done') return 'Reversed.';
      if (outcome.status === 'skipped') return 'It had already been put back by hand.';
      throw new Error(outcome.reason);
    },
    backfill: async (days) => {
      const secrets = loadClientSecrets(config);
      let added = 0;
      for (const account of listAccounts(db)) added += await backfill(db, createGmailApi(clientFor(config, secrets, account.email)), account.id, days);
      return added;
    },
    putBack: async (accountId, messageId) => {
      const last = lastStandingChange(db, accountId, messageId);
      if (last) await undo({ db, mailbox: mailboxFor(config, accountId) }, last.id);
      // The corrected decision is waiting to be carried out; do it now, not at the next interval.
      live.wake?.now();
      return last !== null;
    },
    startEval: async (request) => {
      const spec = current().model;
      if (!spec) throw new Error('Choose a model first.');
      const tier = await openModelTier(config, spec);
      return startEval({ db, judge: tier.judge, model: spec, guidelines: tier.guidelines() }, request).id;
    },
    ruleFilter: async (ruleId, on) => {
      const rule = getRuleFilter(db, ruleId);
      if (!rule) throw new Error('That rule no longer exists.');
      const deps = { db, mailbox: mailboxFor(config, rule.accountId) };
      if (on) await writeRuleFilter(deps, ruleId);
      else await removeRuleFilter(deps, ruleId);
    },
    checkNow: () => live.wake?.now(),
    activity: () => live.activity,
  };
}

/**
 * Start serving the dashboard from this process and say where it is. Used by `run`, so one process
 * keeps sift online, and by `dashboard` on its own.
 */
async function serveDashboard(
  config: Config,
  db: ReturnType<typeof openDb>,
  options: { port?: number; host?: string; controls: Controls; dev?: boolean },
): Promise<() => void> {
  const { settings } = config;
  const port = options.port ?? settings.dashboardPort;
  // --host replaces the setting: a container listens on every interface and its port mapping decides who can reach it.
  const listen = options.host ? [options.host] : await listenAddresses(settings);
  // Answer to any name or address that is this machine and to nothing else.
  const allowedHosts = [...machineNames(), ...(settings.dashboardHost && settings.dashboardHost !== 'all' ? [settings.dashboardHost] : [])];
  // In dev the page is rebuilt alongside, and served as it changes.
  if (!options.dev) await ensureWebBuilt();

  const servers = listen.map(() =>
    createDashboardServer(db, {
      ...(options.dev ? { dev: true } : {}),
      allowedHosts,
      controls: options.controls,
      signIn: buildSignIn(config, db),
      sessionSecret: sessionSecret(config),
      signInAddresses: signInAddresses(port),
    }),
  );
  await Promise.all(
    servers.map(
      (server, index) =>
        new Promise<void>((resolve, reject) => {
          server.once('error', (error: NodeJS.ErrnoException) =>
            reject(
              error.code === 'EADDRINUSE'
                ? new Error(`Port ${port} is already in use. Is sift already running? If not, change dashboard.port in ${config.settingsPath}.`)
                : error,
            ),
          );
          server.listen(port, listen[index], resolve);
        }),
    ),
  );

  const [first, ...others] = signInAddresses(port);
  ui.fields([['Dashboard', paint.bold(first ?? '')], ...others.map((url) => ['', paint.bold(url)] as const)]);
  if (others.length > 0) ui.info(`The second needs ${paint.cmd(`tailscale serve --bg ${port}`)} once. Sign in there with Google.`);
  return () => {
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
  };
}

function portOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${value}`);
  return port;
}

async function dashboard(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const port = portOption(values.port);
  const config = loadConfig();
  const secrets = checkSecrets(config, true);
  const db = openDb(config.dbPath);
  ui.heading('dashboard');
  secrets();
  const controls = buildControls(config, db, { activity: { sorting: false, lastPassAt: null, problems: [], expired: [] } });
  const stop = await serveDashboard(config, db, { controls, ...(port === undefined ? {} : { port }), ...(values.host ? { host: values.host } : {}) });
  ui.info('Only the dashboard is running. `sift run` also sorts mail.');
  ui.blank();
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  stop();
  db.close();
}

async function openModelTier(config: Config, spec: string) {
  const models = openModels(config);
  const model = resolveModel(models, spec);
  if (!(await models.getAuth(model)))
    throw new Error(`Not signed in to ${model.provider}. Run \`sift init\` and choose Model, or set its API key in the environment.`);
  return {
    judge: createJudge(models, model, (message) => ui.fail(`Model call failed: ${message}`)),
    // Read on every pass, so edits to the file take effect without a restart.
    guidelines: () => (existsSync(config.guidelinesPath) ? readFileSync(config.guidelinesPath, 'utf8') : ''),
  };
}

async function run(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      act: { type: 'boolean', default: false },
      observe: { type: 'boolean', default: false },
      once: { type: 'boolean', default: false },
      interval: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-dashboard': { type: 'boolean', default: false },
      // Set by `sift dev`.
      dev: { type: 'boolean', default: false },
    },
  });
  if (values.act && values.observe) throw new Error('Choose one of --act and --observe.');
  const intervalFlag = values.interval === undefined ? undefined : Number(values.interval);
  if (intervalFlag !== undefined && (!Number.isFinite(intervalFlag) || intervalFlag < 5)) throw new Error('--interval must be at least 5 seconds.');
  const config = loadConfig();
  const secrets = checkSecrets(config, true);

  const db = openDb(config.dbPath);
  try {
    const log = (line: string) => ui.plain(`${paint.dim(new Date().toLocaleTimeString(undefined, { hour12: false }))}  ${line}`);

    // Settings are read again before every pass, so changes made in the dashboard or sift.toml apply
    // without a restart. A flag given here wins for as long as this process runs.
    const tiers = new Map<string, Awaited<ReturnType<typeof openModelTier>> | null>();
    let announced = '';
    const next = async () => {
      const { settings } = loadConfig();
      const act = values.observe ? false : values.act || settings.act;
      const spec = settings.model;
      if (spec && !tiers.has(spec)) {
        try {
          tiers.set(spec, await openModelTier(config, spec));
        } catch (error) {
          tiers.set(spec, null);
          ui.fail(error instanceof Error ? error.message : String(error));
        }
      }
      const tier = spec ? tiers.get(spec) : null;
      const state = `${act ? 'acting' : 'observing'} · ${spec ?? 'no model'}`;
      if (announced !== '' && announced !== state) log(`Now ${state}`);
      announced = state;
      return {
        act,
        heuristics: settings.heuristics,
        ...(tier ? { model: { ...tier, fewShot: settings.fewShot } } : {}),
        unsubscribe: (accountId: string, messageId: string) => unsubscribe({ db }, accountId, messageId),
        ...(settings.examplesKeepDays ? { examplesKeepDays: settings.examplesKeepDays } : {}),
        connect: (account: Account) => {
          const client = clientFor(config, loadClientSecrets(config), account.email);
          return { api: createGmailApi(client), mailbox: createGmailMailbox(client) };
        },
        log,
        intervalMs: (intervalFlag ?? settings.interval) * 1000,
        ...(settings.retentionDays === undefined ? {} : { retentionDays: settings.retentionDays }),
      };
    };

    const first = await next();
    ui.heading(first.act ? 'acting' : 'observing', `${config.settings.model ?? 'no model'} · every ${first.intervalMs / 1000}s`);
    secrets();
    if (!hasClientSecrets(config)) ui.warn(`No Google client yet. Run ${paint.cmd('sift init')}.`);
    else if (listAccounts(db).length === 0) ui.warn('No Gmail account yet. Open the dashboard and sign in with Google.');
    else if (!first.act) ui.info('Gmail is not changed while sift is observing. Switch it in the dashboard, under Settings.');

    if (values.once) {
      ui.blank();
      const results = await runOnce(db, first);
      if (results.some((r) => r.error)) process.exitCode = 1;
      return;
    }

    // One process keeps sift online: the same one that sorts mail serves the dashboard.
    const wake = createWake();
    const activity: Activity = { sorting: true, lastPassAt: null, problems: [], expired: [] };
    const port = portOption(values.port);
    const stopDashboard = values['no-dashboard']
      ? () => {}
      : await serveDashboard(config, db, {
          controls: buildControls(config, db, { wake, activity }),
          ...(values.dev ? { dev: true } : {}),
          ...(port === undefined ? {} : { port }),
          ...(values.host ? { host: values.host } : {}),
        });
    ui.blank();
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    try {
      await runLoop(db, next, {
        signal: stop.signal,
        wake,
        onPass: (results: PassResult[]) => {
          activity.lastPassAt = Date.now();
          activity.problems = results.flatMap((r) => (r.error ? [`${r.email}: ${r.error}`] : []));
          activity.expired = results.filter((r) => r.expired).map((r) => r.email);
        },
      });
    } finally {
      stopDashboard();
    }
  } finally {
    db.close();
  }
}

/**
 * For working on sift itself: `sift run`, restarted whenever the server's code changes, beside a build
 * of the page that is redone whenever the page's code changes. The page reloads by itself on either.
 * Arguments are passed on to `run`.
 */
async function dev(args: string[]): Promise<void> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  if (!existsSync(join(root, 'web/src'))) throw new Error('`sift dev` needs a checkout of the source. Use `sift run` here.');
  ui.heading('dev', 'restarts on server changes, reloads on page changes');
  ui.blank();

  const server = spawn(
    process.execPath,
    ['--watch', '--watch-preserve-output', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), 'run', '--dev', ...args],
    { stdio: 'inherit' },
  );
  const page = spawn('pnpm', ['--filter', 'sift-web', 'exec', 'vite', 'build', '--watch', '--logLevel', 'warn'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // The page build is quiet unless it has something to say, which is then an error or a warning.
  for (const stream of [page.stdout, page.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line.trim() !== '') ui.plain(`${paint.dim('page')}  ${line}`);
    });
  }

  const stop = () => {
    server.kill('SIGTERM');
    page.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  // Either one ending ends both: a dev session with half of it gone is only confusing.
  await new Promise<void>((resolve) => {
    let left = 2;
    const ended = () => {
      stop();
      if (--left === 0) resolve();
    };
    server.once('exit', ended);
    page.once('exit', ended);
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // --home works before or after the command; it is the same as setting SIFT_HOME.
  const homeAt = argv.indexOf('--home');
  if (homeAt !== -1) {
    const [, home] = argv.splice(homeAt, 2);
    if (!home) throw new Error('--home needs a directory.');
    process.env['SIFT_HOME'] = home;
  }
  loadEnvFiles(resolveHome());
  const [command, ...args] = argv;
  if (command === 'status') status();
  else if (command === 'init') await init();
  else if (command === 'dashboard') await dashboard(args);
  else if (command === 'run') await run(args);
  else if (command === 'dev') await dev(args);
  else if (command === undefined || command === 'help' || command === '--help' || command === '-h') help();
  else {
    ui.fail(`There is no ${paint.cmd(`sift ${command}`)} command. ${paint.cmd('sift help')} lists them.`);
    process.exitCode = 2;
  }
}

try {
  await main();
} catch (error) {
  ui.fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  closeTerminal();
}
