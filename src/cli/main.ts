#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type MessageAction, type Outcome, execute, undo } from '../actions/executor.ts';
import { type Config, loadConfig, saveSettings } from '../config.ts';
import { createDashboardServer } from '../dashboard/server.ts';
import { ensureWebBuilt } from './web-build.ts';
import { runLoop, runOnce } from '../daemon/run.ts';
import { syncAccount } from '../daemon/sync.ts';
import { createGmailApi } from '../gmail/api.ts';
import { authorize, clientFor, hasClientSecrets, installClient, loadClientSecrets, saveRefreshToken } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { createJudge } from '../model/judge.ts';
import { login, openModels, resolveModel } from '../model/models.ts';
import { type Account, connectAccount, listAccounts } from '../store/accounts.ts';
import { getAction, listRecentActions } from '../store/actions.ts';
import { listCategories, updateCategory } from '../store/categories.ts';
import { openDb } from '../store/db.ts';
import { type SetupState, runInit } from './init.ts';
import { dashboardUrls, listenAddresses, machineNames } from './network.ts';
import { closeTerminal, readLine } from './terminal.ts';
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
  ['auth', 'connect a Gmail account'],
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
    ['Dashboard', `${dashboardUrls(settings)[0]}${paint.dim(settings.dashboardHost ? '' : ' · this machine only')}`],
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

/** Run the Gmail sign-in and record the account. Returns the connected address. */
async function connectGmail(config: Config, options: { port?: number; host?: string } = {}): Promise<string> {
  const secrets = loadClientSecrets(config);
  // Stop waiting for a pasted URL once the browser callback has finished the sign-in.
  const paste = new AbortController();
  const pasted = readLine(paste.signal).then((line) => line ?? new Promise<string>(() => {}));
  try {
    const { refreshToken, client } = await authorize(secrets, {
      port: options.port ?? 0,
      ...(options.host ? { host: options.host } : {}),
      pasted,
      onUrl: (url) => {
        ui.info('Open this in a browser and approve access:');
        ui.link(url);
        if (config.settings.dashboardHost)
          ui.info('The page the browser ends on will not load, because it points back at this server: paste its address here.');
        else ui.info('If the browser is on another machine, the page it ends on will not load: paste its address here.');
        ui.info('"Access blocked" means this account is not a test user and the app is not published:');
        ui.info('https://console.cloud.google.com/auth/audience');
        ui.blank();
        ui.waiting(config.settings.dashboardHost ? 'Paste the address:' : 'Waiting for the browser, or paste the address:');
      },
    });
    const profile = await spin('Checking the account', () => createGmailApi(client).getProfile());
    saveRefreshToken(config, profile.emailAddress, refreshToken);
    const db = openDb(config.dbPath);
    connectAccount(db, profile.emailAddress, profile.historyId);
    db.close();
    return profile.emailAddress;
  } finally {
    paste.abort();
    ui.blank();
  }
}

async function auth(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port: ${values.port}`);
  const email = await connectGmail(loadConfig(), { port, ...(values.host ? { host: values.host } : {}) });
  ui.ok(`Connected ${paint.bold(email)}`);
}

async function init(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error(`Invalid --port: ${values.port}`);
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
    connectGmail: () => connectGmail(config, { ...(port === undefined ? {} : { port }), ...(values.host ? { host: values.host } : {}) }),
    loginModel: (choice) => login(models, config, choice.provider, choice.type, ui),
    availableModels: async (provider) => (await models.getAvailable(provider)).map((m) => m.id),
    categories: (account) => withDb((db) => listCategories(db, account)),
    dashboardUrls: () => dashboardUrls(config.settings),
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

/**
 * Start serving the dashboard from this process and say where it is. Used by `run`, so one process
 * keeps sift online, and by `dashboard` on its own.
 */
async function serveDashboard(config: Config, db: ReturnType<typeof openDb>, options: { port?: number; host?: string } = {}): Promise<() => void> {
  const { settings } = config;
  const port = options.port ?? settings.dashboardPort;
  // --host replaces the setting: a container listens on 0.0.0.0 and its port mapping decides who can reach it.
  const listen = options.host ? [options.host] : await listenAddresses(settings);
  // Beyond localhost, answer to any name or address that is this machine, and to nothing else.
  const beyondLocalhost = listen.some((address) => address !== '127.0.0.1');
  await ensureWebBuilt();
  const allowedHosts = beyondLocalhost
    ? [...machineNames(), ...(settings.dashboardHost && settings.dashboardHost !== 'all' ? [settings.dashboardHost] : [])]
    : [];

  const servers = listen.map(() => createDashboardServer(db, { allowedHosts }));
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

  const [first, ...others] = dashboardUrls(settings, port);
  ui.fields([['Dashboard', paint.bold(first ?? '')], ...others.map((url) => ['', url] as const)]);
  if (beyondLocalhost) ui.info('No login: anyone on those networks can read it.');
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
  const stop = await serveDashboard(config, db, { ...(port === undefined ? {} : { port }), ...(values.host ? { host: values.host } : {}) });
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
  const config = loadConfig();
  const interval = values.interval === undefined ? config.settings.interval : Number(values.interval);
  if (!Number.isFinite(interval) || interval < 5) throw new Error('--interval must be at least 5 seconds.');
  const act = values.observe ? false : values.act || config.settings.act;
  const modelSpec = config.settings.model;

  const db = openDb(config.dbPath);
  try {
    if (listAccounts(db).length === 0) throw new Error('No Gmail account is connected yet. Run `sift init`.');
    const secrets = loadClientSecrets(config);
    const modelTier = modelSpec ? await openModelTier(config, modelSpec) : undefined;
    const options = {
      act,
      ...(modelTier ? { model: modelTier } : {}),
      connect: (account: Account) => {
        const client = clientFor(config, secrets, account.email);
        return { api: createGmailApi(client), mailbox: createGmailMailbox(client) };
      },
      log: (line: string) => ui.plain(`${paint.dim(new Date().toLocaleTimeString(undefined, { hour12: false }))}  ${line}`),
    };
    ui.heading(act ? 'acting' : 'observing', `${modelSpec ?? 'no model'} · every ${interval}s`);
    if (!act) ui.info(`Gmail is not changed until you set act = true in ${paint.path(config.settingsPath)}`);

    if (values.once) {
      ui.blank();
      const results = await runOnce(db, options);
      if (results.some((r) => r.error)) process.exitCode = 1;
      return;
    }
    // One process keeps sift online: the same one that sorts mail serves the dashboard.
    const port = portOption(values.port);
    const stopDashboard = values['no-dashboard']
      ? () => {}
      : await serveDashboard(config, db, { ...(port === undefined ? {} : { port }), ...(values.host ? { host: values.host } : {}) });
    ui.blank();
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    try {
      await runLoop(db, { ...options, intervalMs: interval * 1000, signal: stop.signal });
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
  else if (command === 'init') await init(args);
  else if (command === 'auth') await auth(args);
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
