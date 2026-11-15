#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs, promisify } from 'node:util';
import { type MessageAction, type Outcome, execute, undo } from '../actions/executor.ts';
import { type Config, loadConfig, saveSettings } from '../config.ts';
import { backfill } from '../daemon/backfill.ts';
import type { Activity, Controls, SignIn } from '../dashboard/controls.ts';
import { createDashboardServer } from '../dashboard/server.ts';
import { ensureWebBuilt } from './web-build.ts';
import { type PassResult, type Wake, createWake, runLoop, runOnce } from '../daemon/run.ts';
import { syncAccount } from '../daemon/sync.ts';
import { createGmailApi } from '../gmail/api.ts';
import { browserSignInUrl, clientFor, completeBrowserSignIn, hasClientSecrets, installClient, loadClientSecrets, saveRefreshToken } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { createJudge } from '../model/judge.ts';
import { login, openModels, resolveModel } from '../model/models.ts';
import { type Account, connectAccount, listAccounts } from '../store/accounts.ts';
import { getAction, listRecentActions } from '../store/actions.ts';
import { listCategories, updateCategory } from '../store/categories.ts';
import { openDb } from '../store/db.ts';
import { type SetupState, runInit } from './init.ts';
import { listenAddresses, machineNames, tailscaleName } from './network.ts';
import { closeTerminal } from './terminal.ts';
import { disposition, paint, spin, ui } from './ui.ts';
import { addRule, listRules, removeRule } from '../store/rules.ts';
import type { RuleMatch } from '../triage/stages/rules.ts';

const PLANNED = ['review'] as const;

/** sift is set up and started from here; looking at and steering it happens in the dashboard. */
const MAIN_COMMANDS: readonly (readonly [string, string])[] = [
  ['init', 'Set sift up, or finish setting it up'],
  ['run', 'Sort your mail continuously, and serve the dashboard'],
  ['status', 'What is set up and how much sift has recorded'],
];
const OTHER_COMMANDS: readonly (readonly [string, string])[] = [
  ['rules', 'list | add --do <keep|archive|spam> --from-domain <d> | remove <id>'],
  ['categories', 'list | set <key> --do <keep|archive|review|spam>'],
  ['log', 'recent changes to your mailbox'],
  ['undo <id>', 'reverse one change'],
  ['dashboard', 'serve the dashboard without sorting mail'],
  ['login <provider>', 'sign in to a model provider'],
  ['models', 'list the models you can use'],
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

function status(): void {
  const config = loadConfig();
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
  const questions = count('questions', 'WHERE answered_at IS NULL');
  const troubled = count('actions', `WHERE status IN ('failed', 'unknown', 'pending')`);
  ui.fields([
    ['Recorded', `${plural(count('messages'), 'message')} · ${plural(count('decisions'), 'decision')} · ${plural(count('actions'), 'change')}`],
    ['Learned', `${plural(count('rules'), 'rule')} · ${plural(count('senders'), 'sender')}`],
    ...(questions > 0 ? [['Waiting', paint.mark(` ${plural(questions, 'question')} for you `)] as const] : []),
    ...(troubled > 0 ? [['Check', paint.bad(`${plural(troubled, 'change')} failed or unconfirmed; see sift log`)] as const] : []),
  ]);
  ui.blank();
  if (!ready) {
    ui.warn(`Setup is not finished. Run ${paint.cmd('sift init')}.`);
    ui.blank();
  }
  db.close();
}

async function init(): Promise<void> {
  const config = loadConfig();
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
    categories: (account) => withDb((db) => listCategories(db, account)),
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

async function sync(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { verbose: { type: 'boolean', default: false } } });
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const accounts = listAccounts(db);
    if (accounts.length === 0) throw new Error('No Gmail account is connected yet. Run `sift init`.');
    const secrets = loadClientSecrets(config);
    for (const account of accounts) {
      const report = await spin(`Checking ${account.email}`, () => syncAccount(db, createGmailApi(clientFor(config, secrets, account.email)), account));
      const recovery = report.mode === 'recovery' ? paint.dim(' · history had expired, searched the last 7 days') : '';
      ui.ok(`${paint.bold(account.email)}  ${plural(report.added.length, 'new message')}${paint.dim(` · ${report.skipped} skipped`)}${recovery}`);
      if (values.verbose && report.added.length > 0) {
        ui.blank();
        ui.table(
          ['Message id', 'From', 'Subject'],
          report.added.map((m) => [paint.dim(m.messageId), m.from.address, m.subject.slice(0, 60)]),
        );
      }
    }
  } finally {
    db.close();
  }
}

const mailboxFor = (config: Config, email: string) => createGmailMailbox(clientFor(config, loadClientSecrets(config), email));

function printOutcome(outcome: Outcome): void {
  if (outcome.status === 'done') {
    ui.ok(`Done ${paint.dim(`· sift undo ${outcome.actionId} reverses it`)}`);
  } else if (outcome.status === 'skipped') ui.skip(`Nothing changed: ${outcome.reason}`);
  else {
    ui.fail(`Change #${outcome.actionId} ${outcome.status === 'unknown' ? 'could not be confirmed' : 'failed'}: ${outcome.reason}`);
    process.exitCode = 1;
  }
}

async function apply(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { label: { type: 'string' }, account: { type: 'string' } } });
  const [type, messageId] = positionals;
  if (!messageId || (type !== 'archive' && type !== 'label' && type !== 'spam'))
    throw new Error('Usage: sift apply <archive|label|spam> <message-id> [--label <name>]');

  let action: MessageAction;
  if (type === 'label') {
    if (!values.label) throw new Error('sift apply label needs --label <name>.');
    action = { type, label: values.label };
  } else if (type === 'archive') action = values.label ? { type, label: values.label } : { type };
  else action = { type };

  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const account = pickAccount(listAccounts(db), values.account);
    printOutcome(await execute({ db, mailbox: mailboxFor(config, account.email) }, account.id, messageId, action));
  } finally {
    db.close();
  }
}

function log(args: string[]): void {
  const { values } = parseArgs({ args, options: { limit: { type: 'string', default: '20' } } });
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid --limit: ${values.limit}`);
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const actions = listRecentActions(db, limit);
  db.close();
  if (actions.length === 0) {
    ui.skip('No changes yet');
    return;
  }
  const state = (status: string) => (status === 'done' ? status : status === 'undone' ? paint.dim(status) : paint.bad(status));
  ui.blank();
  ui.table(
    ['#', 'When', 'Change', 'Result', 'Message'],
    actions.map((a) => [
      String(a.id),
      paint.dim(new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })),
      a.payload.undoOf === undefined ? a.type : `undo of #${a.payload.undoOf}`,
      state(a.status),
      `${paint.dim(a.messageId)}${a.error ? `  ${paint.bad(a.error)}` : ''}`,
    ]),
  );
  ui.blank();
}

async function undoCommand(args: string[]): Promise<void> {
  const id = Number(args[0]);
  if (!Number.isInteger(id) || id < 1) throw new Error('Usage: sift undo <action-id>  (see `sift log`)');
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const action = getAction(db, id);
    if (!action) throw new Error(`There is no change #${id}.`);
    const outcome = await undo({ db, mailbox: mailboxFor(config, action.accountId) }, id);
    if (outcome.status === 'done') ui.ok(`Reversed change #${id} ${paint.dim(`· recorded as #${outcome.actionId}`)}`);
    else if (outcome.status === 'skipped') ui.ok(`Change #${id} had already been put back by hand; marked as undone`);
    else printOutcome(outcome);
  } finally {
    db.close();
  }
}

/** The secret in the dashboard's access link, created the first time it is needed. */
function sessionSecret(config: Config): string {
  if (existsSync(config.dashboardKeyPath)) return readFileSync(config.dashboardKeyPath, 'utf8').trim();
  const key = randomBytes(32).toString('base64url');
  writeFileSync(config.dashboardKeyPath, key, { mode: 0o600 });
  return key;
}

/** Addresses Google can sign someone in at: this machine, and its Tailscale name over HTTPS. */
function signInAddresses(port: number): string[] {
  const name = tailscaleName();
  return [`http://localhost:${port}`, ...(name ? [`https://${name}`] : [])];
}

/** Google sign-in from the dashboard: the same step connects the Gmail account and signs the viewer in. */
function buildSignIn(config: Config, db: ReturnType<typeof openDb>): SignIn {
  return {
    client: () => (hasClientSecrets(config) ? loadClientSecrets(config).kind : null),
    url: (redirectUri, state, challenge) => browserSignInUrl(loadClientSecrets(config), { redirectUri, state, challenge }),
    complete: async (redirectUri, code, verifier, allowNew) => {
      const { email, historyId, refreshToken } = await completeBrowserSignIn(loadClientSecrets(config), { redirectUri, code, verifier });
      const accounts = listAccounts(db);
      const known = accounts.some((a) => a.email === email);
      if (!known && accounts.length > 0 && !allowNew) throw new Error(`${email} is not the account sift is connected to.`);
      saveRefreshToken(config, email, refreshToken);
      // A new account starts from now; a known one keeps its place.
      if (!known) connectAccount(db, email, historyId);
      return email;
    },
  };
}

/** What the dashboard may ask this process to do. See `Controls`. */
function buildControls(config: Config, db: ReturnType<typeof openDb>, live: { wake?: Wake; activity: Activity }): Controls {
  const current = () => loadConfig().settings;
  return {
    settings: () => {
      const s = current();
      return { act: s.act, interval: s.interval, model: s.model ?? null };
    },
    saveSettings: (change) => {
      const { model: _old, ...rest } = current();
      const model = change.model === undefined ? current().model : (change.model ?? undefined);
      saveSettings(config, {
        ...rest,
        ...(change.act === undefined ? {} : { act: change.act }),
        ...(change.interval === undefined ? {} : { interval: change.interval }),
        ...(model ? { model } : {}),
      });
      live.wake?.now();
    },
    models: async () => (await openModels(config).getAvailable()).map((m) => `${m.provider}/${m.id}`),
    guidelines: () => (existsSync(config.guidelinesPath) ? readFileSync(config.guidelinesPath, 'utf8') : ''),
    saveGuidelines: (text) => writeFileSync(config.guidelinesPath, text, { mode: 0o600 }),
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
  options: { port?: number; host?: string; controls: Controls },
): Promise<() => void> {
  const { settings } = config;
  const port = options.port ?? settings.dashboardPort;
  // --host replaces the setting: a container listens on every interface and its port mapping decides who can reach it.
  const listen = options.host ? [options.host] : await listenAddresses(settings);
  // Answer to any name or address that is this machine and to nothing else.
  const allowedHosts = [...machineNames(), ...(settings.dashboardHost && settings.dashboardHost !== 'all' ? [settings.dashboardHost] : [])];
  await ensureWebBuilt();

  const servers = listen.map(() =>
    createDashboardServer(db, {
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
  const db = openDb(config.dbPath);
  ui.heading('dashboard');
  const controls = buildControls(config, db, { activity: { sorting: false, lastPassAt: null, problems: [] } });
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

function pickAccount(accounts: Account[], email: string | undefined): Account {
  const account = email ? accounts.find((a) => a.email === email.toLowerCase()) : accounts.length === 1 ? accounts[0] : undefined;
  if (!account) throw new Error(accounts.length === 0 ? 'No Gmail account is connected yet. Run `sift init`.' : 'Choose an account with --account <email>.');
  return account;
}

async function openModelTier(config: Config, spec: string) {
  const models = openModels(config);
  const model = resolveModel(models, spec);
  if (!(await models.getAuth(model)))
    throw new Error(`Not signed in to ${model.provider}. Run \`sift login ${model.provider}\` or set its API key in the environment.`);
  return {
    judge: createJudge(models, model, (message) => ui.fail(`Model call failed: ${message}`)),
    // Read on every pass, so edits to the file take effect without a restart.
    guidelines: () => (existsSync(config.guidelinesPath) ? readFileSync(config.guidelinesPath, 'utf8') : ''),
  };
}

async function loginCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { 'api-key': { type: 'boolean', default: false } } });
  const [provider] = positionals;
  if (!provider) throw new Error('Usage: sift login <provider> [--api-key]   e.g. sift login openai-codex');
  const config = loadConfig();
  await login(openModels(config), config, provider, values['api-key'] ? 'api_key' : 'oauth', ui);
  ui.ok(`Signed in to ${paint.bold(provider)}`);
}

async function listModels(): Promise<void> {
  const config = loadConfig();
  const available = await spin('Listing models', () => openModels(config).getAvailable());
  if (available.length === 0) {
    ui.skip(`No models yet. Sign in with ${paint.cmd('sift init')} or ${paint.cmd('sift login <provider>')}`);
    return;
  }
  const current = config.settings.model;
  for (const model of available) {
    const spec = `${model.provider}/${model.id}`;
    if (spec === current) ui.plain(`${paint.mark(` ${spec} `)} ${paint.dim('in use')}`);
    else ui.plain(spec);
  }
}

function categories(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { account: { type: 'string' }, do: { type: 'string' }, label: { type: 'string' }, 'no-label': { type: 'boolean', default: false } },
  });
  const [verb, key] = positionals;
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const account = pickAccount(listAccounts(db), values.account);
    if (verb === 'set') {
      const disposition = values.do;
      if (!key || (disposition === undefined && values.label === undefined && !values['no-label']))
        throw new Error('Usage: sift categories set <key> --do <keep|archive|review|spam> [--label <name> | --no-label]');
      if (disposition !== undefined && disposition !== 'keep' && disposition !== 'archive' && disposition !== 'review' && disposition !== 'spam')
        throw new Error('--do must be keep, archive, review or spam.');
      const label = values['no-label'] ? null : values.label;
      if (!updateCategory(db, account.id, key, { ...(disposition ? { disposition } : {}), ...(label === undefined ? {} : { label }) }))
        throw new Error(`No category "${key}". Run \`sift categories\` to list them.`);
    } else if (verb !== undefined && verb !== 'list') throw new Error('Usage: sift categories [list | set <key> ...]');
    ui.blank();
    ui.table(
      ['Key', 'Kind', 'sift will', 'Label'],
      listCategories(db, account.id).map((c) => [paint.bold(c.key), c.name, disposition(c.disposition), c.label ? paint.dim(c.label) : '']),
    );
    ui.blank();
  } finally {
    db.close();
  }
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
    },
  });
  if (values.act && values.observe) throw new Error('Choose one of --act and --observe.');
  const intervalFlag = values.interval === undefined ? undefined : Number(values.interval);
  if (intervalFlag !== undefined && (!Number.isFinite(intervalFlag) || intervalFlag < 5)) throw new Error('--interval must be at least 5 seconds.');
  const config = loadConfig();

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
        ...(tier ? { model: tier } : {}),
        connect: (account: Account) => {
          const client = clientFor(config, loadClientSecrets(config), account.email);
          return { api: createGmailApi(client), mailbox: createGmailMailbox(client) };
        },
        log,
        intervalMs: (intervalFlag ?? settings.interval) * 1000,
      };
    };

    const first = await next();
    ui.heading(first.act ? 'acting' : 'observing', `${config.settings.model ?? 'no model'} · every ${first.intervalMs / 1000}s`);
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
    const activity: Activity = { sorting: true, lastPassAt: null, problems: [] };
    const port = portOption(values.port);
    const stopDashboard = values['no-dashboard']
      ? () => {}
      : await serveDashboard(config, db, {
          controls: buildControls(config, db, { wake, activity }),
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
        },
      });
    } finally {
      stopDashboard();
    }
  } finally {
    db.close();
  }
}

const CONDITION_NAMES: Record<string, string> = { from: 'from', fromDomain: 'from domain', to: 'to', listId: 'list', subjectContains: 'subject has' };

function rules(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      account: { type: 'string' },
      do: { type: 'string' },
      from: { type: 'string' },
      'from-domain': { type: 'string' },
      to: { type: 'string' },
      'list-id': { type: 'string' },
      'subject-contains': { type: 'string' },
      label: { type: 'string' },
    },
  });
  const [verb, id] = positionals;
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    if (verb === 'remove') {
      if (!id) throw new Error('Usage: sift rules remove <rule-id>');
      if (!removeRule(db, id)) throw new Error(`No rule ${id}.`);
      ui.ok(`Removed ${paint.bold(id)}`);
      return;
    }
    const account = pickAccount(listAccounts(db), values.account);
    if (verb === 'add') {
      const disposition = values.do;
      if (disposition !== 'keep' && disposition !== 'archive' && disposition !== 'spam')
        throw new Error('sift rules add needs --do keep, --do archive or --do spam.');
      const match: RuleMatch = {
        ...(values.from ? { from: values.from } : {}),
        ...(values['from-domain'] ? { fromDomain: values['from-domain'] } : {}),
        ...(values.to ? { to: values.to } : {}),
        ...(values['list-id'] ? { listId: values['list-id'] } : {}),
        ...(values['subject-contains'] ? { subjectContains: values['subject-contains'] } : {}),
      };
      const ruleId = addRule(db, account.id, { match, disposition, ...(values.label ? { label: values.label } : {}) }, 'user');
      ui.ok(`Added ${paint.bold(ruleId)}`);
      return;
    }
    if (verb !== undefined && verb !== 'list') throw new Error('Usage: sift rules <list|add|remove>');
    const all = listRules(db, account.id);
    if (all.length === 0) {
      ui.skip(`No rules yet. Add one with ${paint.cmd('sift rules add --do archive --from-domain example.com')}`);
      return;
    }
    ui.blank();
    ui.table(
      ['Id', 'When mail matches', 'sift will', 'Label', 'Matches'],
      all.map((rule) => [
        paint.bold(rule.id),
        Object.entries(rule.match)
          .map(([key, value]) => `${paint.dim(CONDITION_NAMES[key] ?? key)} ${value}`)
          .join('  '),
        disposition(rule.disposition),
        rule.label ? paint.dim(rule.label) : '',
        String(rule.hits),
      ]),
    );
    ui.blank();
  } finally {
    db.close();
  }
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
  const [command, ...args] = argv;
  if (command === 'status') status();
  else if (command === 'init') await init();
  else if (command === 'sync') await sync(args);
  else if (command === 'apply') await apply(args);
  else if (command === 'log') log(args);
  else if (command === 'undo') await undoCommand(args);
  else if (command === 'dashboard') await dashboard(args);
  else if (command === 'run') await run(args);
  else if (command === 'rules') rules(args);
  else if (command === 'login') await loginCommand(args);
  else if (command === 'models') await listModels();
  else if (command === 'categories') categories(args);
  else if (command === undefined || command === 'help' || command === '--help' || command === '-h') help();
  else if ((PLANNED as readonly string[]).includes(command)) {
    ui.fail(`${paint.cmd(`sift ${command}`)} is not built yet.`);
    process.exitCode = 1;
  } else {
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
