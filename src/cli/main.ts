#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type MessageAction, type Outcome, execute, undo } from '../actions/executor.ts';
import { type Config, loadConfig, saveSettings } from '../config.ts';
import { createDashboardServer } from '../dashboard/server.ts';
import { runLoop, runOnce } from '../daemon/run.ts';
import { syncAccount } from '../daemon/sync.ts';
import { createGmailApi } from '../gmail/api.ts';
import { authorize, clientFor, hasClientSecrets, installClientFile, loadClientSecrets, saveRefreshToken } from '../gmail/auth.ts';
import { createGmailMailbox } from '../gmail/mailbox.ts';
import { createJudge } from '../model/judge.ts';
import { login, openModels, resolveModel } from '../model/models.ts';
import { type Account, connectAccount, listAccounts } from '../store/accounts.ts';
import { getAction, listRecentActions } from '../store/actions.ts';
import { listCategories, updateCategory } from '../store/categories.ts';
import { openDb, schemaVersion } from '../store/db.ts';
import { runInit } from './init.ts';
import { ask, closeTerminal, readLine } from './terminal.ts';
import { addRule, listRules, removeRule } from '../store/rules.ts';
import type { RuleMatch } from '../triage/stages/rules.ts';

const PLANNED = ['review'] as const;

const USAGE = `Usage: sift [--home <dir>] <command>

Everything sift keeps (settings, guidance, database, credentials) is in one directory:
~/.config/sift by default, or the directory given with --home or SIFT_HOME.

  init     Set sift up, or finish setting it up: Google client, Gmail account, model, preferences
  status   Show what is set up, where it lives, and how much sift has recorded
  auth     Connect a Gmail account (init does this for you)
             --port <n>   loopback port (default: a free one)
             --host <ip>  interface to listen on (default 127.0.0.1; use 0.0.0.0 in a container)
  sync     Fetch new inbox mail once and record it; changes nothing in Gmail
             --verbose    list each new message with its id
  apply    Apply one action to one inbox message by hand: sift apply <archive|label|spam> <message-id>
             --label <name>    label to add (required for label; the reason label for archive)
             --account <email> which account, if more than one is connected
  log      Show recent actions from the audit log
             --limit <n>       how many (default 20)
  undo     Reverse a completed action: sift undo <action-id>
  dashboard  Serve a read-only web page of what sift has decided and done
             --port <n>   port (default: dashboard.port in sift.toml)
             --host <ip>  interface to listen on (default 127.0.0.1; use 0.0.0.0 in a container)
  run      Sync and triage continuously, using the settings in sift.toml
             --act / --observe  override "act" for this run
             --once             do a single pass and exit
             --interval <s>     override "interval" for this run
  rules    Manage local rules
             rules list
             rules add --do <keep|archive|spam> [--from <addr>] [--from-domain <domain>] [--to <addr>]
                       [--list-id <id>] [--subject-contains <text>] [--label <name>]
             rules remove <rule-id>
           (rules take --account <email> if more than one account is connected)
  login    Sign in to a model provider for the inference tier: sift login <provider> [--api-key]
             e.g. sift login openai-codex   (ChatGPT Plus/Pro subscription)
  models   List the models you can use; set one as "model" in sift.toml
  categories  Show the kinds of mail and what sift does with each
             categories set <key> --do <keep|archive|review|spam> [--label <name> | --no-label]
  review   Answer questions sift has queued         (not implemented yet)
`;

function status(): void {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const accounts = listAccounts(db);
  console.log(`home:      ${config.home}`);
  console.log(`settings:  ${existsSync(config.settingsPath) ? config.settingsPath : 'not written yet (run `sift init`)'}`);
  console.log(
    `Google client: ${hasClientSecrets(config) ? 'yes' : 'no '}   Gmail: ${accounts.length > 0 ? accounts.map((a) => a.email).join(', ') : 'not connected'}`,
  );
  console.log(`model:     ${config.settings.model ?? 'none (mail no rule covers is left for you)'}`);
  console.log(`mode:      ${config.settings.act ? 'acting on decisions' : 'observing only'}, every ${config.settings.interval}s`);
  console.log(`guidelines: ${existsSync(config.guidelinesPath) ? config.guidelinesPath : 'none'}`);
  console.log(`database:  schema v${schemaVersion(db)}`);
  for (const table of ['messages', 'decisions', 'actions', 'rules', 'senders', 'questions']) {
    const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
    console.log(`  ${table.padEnd(10)} ${row.n}`);
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
        console.log(`Open this URL in a browser and approve access:\n\n${url}\n`);
        console.log("If the browser ends on a page that will not load, paste that page's full URL here and press Enter.");
      },
    });
    const profile = await createGmailApi(client).getProfile();
    saveRefreshToken(config, profile.emailAddress, refreshToken);
    const db = openDb(config.dbPath);
    connectAccount(db, profile.emailAddress, profile.historyId);
    db.close();
    return profile.emailAddress;
  } finally {
    paste.abort();
  }
}

async function auth(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port: ${values.port}`);
  const email = await connectGmail(loadConfig(), { port, ...(values.host ? { host: values.host } : {}) });
  console.log(`Connected ${email}. sift will handle mail that arrives from now on.`);
}

async function init(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' } } });
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error(`Invalid --port: ${values.port}`);
  const config = loadConfig();
  const models = openModels(config);
  const terminal = { ask: (question: string) => ask(question), say: (line: string) => console.log(line) };
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
    terminal,
    saveSettings: (settings) => saveSettings(config, settings),
    hasGoogleClient: () => hasClientSecrets(config),
    installGoogleClient: (path) => installClientFile(config, path),
    connectedAccounts: () => withDb((db) => listAccounts(db).map((a) => a.email)),
    connectGmail: () => connectGmail(config, { ...(port === undefined ? {} : { port }), ...(values.host ? { host: values.host } : {}) }),
    loginModel: (choice) => login(models, config, choice.provider, choice.type, { ask, say: terminal.say }),
    availableModels: async (provider) => (await models.getAvailable(provider)).map((m) => m.id),
    categories: (account) => withDb((db) => listCategories(db, account)),
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
      const report = await syncAccount(db, createGmailApi(clientFor(config, secrets, account.email)), account);
      const recovery = report.mode === 'recovery' ? ' (history cursor had expired; searched the last 7 days)' : '';
      console.log(`${account.email}: ${report.added.length} new, ${report.skipped} skipped${recovery}`);
      if (values.verbose) for (const m of report.added) console.log(`  ${m.messageId}  ${m.from.address}  ${m.subject}`);
    }
  } finally {
    db.close();
  }
}

const mailboxFor = (config: Config, email: string) => createGmailMailbox(clientFor(config, loadClientSecrets(config), email));

function printOutcome(outcome: Outcome): void {
  if (outcome.status === 'done') console.log(`Done (action ${outcome.actionId}). Reverse it with: sift undo ${outcome.actionId}`);
  else if (outcome.status === 'skipped') console.log(`Nothing changed: ${outcome.reason}.`);
  else {
    console.error(`Action ${outcome.actionId} ${outcome.status}: ${outcome.reason}`);
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
  if (actions.length === 0) console.log('No actions yet.');
  for (const a of actions) {
    const when = new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ');
    const target = a.payload.undoOf === undefined ? '' : ` of ${a.payload.undoOf}`;
    console.log(
      `${String(a.id).padStart(5)}  ${when}  ${a.status.padEnd(7)}  ${(a.type + target).padEnd(12)}  ${a.messageId}${a.error ? `  (${a.error})` : ''}`,
    );
  }
}

async function undoCommand(args: string[]): Promise<void> {
  const id = Number(args[0]);
  if (!Number.isInteger(id) || id < 1) throw new Error('Usage: sift undo <action-id>  (see `sift log`)');
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const action = getAction(db, id);
    if (!action) throw new Error(`No action ${id}.`);
    const outcome = await undo({ db, mailbox: mailboxFor(config, action.accountId) }, id);
    if (outcome.status === 'done') console.log(`Undid action ${id} (recorded as action ${outcome.actionId}).`);
    else if (outcome.status === 'skipped') console.log(`Action ${id} had already been reversed by hand; marked as undone.`);
    else printOutcome(outcome);
  } finally {
    db.close();
  }
}

async function dashboard(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' } } });
  const config = loadConfig();
  const port = values.port === undefined ? config.settings.dashboardPort : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${values.port}`);
  const db = openDb(config.dbPath);
  const server = createDashboardServer(db);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, values.host, resolve);
  });
  console.log(`sift dashboard: http://localhost:${port}  (Ctrl+C to stop)`);
  await new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve());
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  server.closeAllConnections();
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
    judge: createJudge(models, model, (message) => console.error(`model: ${message}`)),
    // Read on every pass, so edits to the file take effect without a restart.
    guidelines: () => (existsSync(config.guidelinesPath) ? readFileSync(config.guidelinesPath, 'utf8') : ''),
  };
}

async function loginCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { 'api-key': { type: 'boolean', default: false } } });
  const [provider] = positionals;
  if (!provider) throw new Error('Usage: sift login <provider> [--api-key]   e.g. sift login openai-codex');
  const config = loadConfig();
  await login(openModels(config), config, provider, values['api-key'] ? 'api_key' : 'oauth', { ask, say: (line) => console.log(line) });
  console.log(`Signed in to ${provider}. Run \`sift models\`, then set \`model\` in ${config.settingsPath}.`);
}

async function listModels(): Promise<void> {
  const available = await openModels(loadConfig()).getAvailable();
  if (available.length === 0) console.log('No models available. Sign in with `sift login <provider>` or set a provider API key in the environment.');
  for (const model of available) console.log(`${model.provider}/${model.id}`);
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
    for (const c of listCategories(db, account.id)) console.log(`${c.key.padEnd(14)} ${c.disposition.padEnd(8)} ${(c.label ?? '').padEnd(20)} ${c.name}`);
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
      log: (line: string) => console.log(`${new Date().toISOString().slice(0, 19).replace('T', ' ')}  ${line}`),
    };
    console.log(modelSpec ? `Model: ${modelSpec}` : 'No model is set: mail no rule covers is left for you. `sift init` sets one up.');
    console.log(
      act
        ? 'sift is acting: decisions are carried out in Gmail.'
        : `sift is observing: decisions are recorded, Gmail is not changed. Set act = true in ${config.settingsPath} to carry them out.`,
    );

    if (values.once) {
      const results = await runOnce(db, options);
      if (results.some((r) => r.error)) process.exitCode = 1;
      return;
    }
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    await runLoop(db, { ...options, intervalMs: interval * 1000, signal: stop.signal });
  } finally {
    db.close();
  }
}

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
      console.log(`Removed ${id}.`);
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
      console.log(`Added ${ruleId}. It applies to mail triaged from now on.`);
      return;
    }
    if (verb !== undefined && verb !== 'list') throw new Error('Usage: sift rules <list|add|remove>');
    const all = listRules(db, account.id);
    if (all.length === 0) console.log('No rules yet. Add one with: sift rules add --do archive --from-domain example.com');
    for (const rule of all) {
      const conditions = Object.entries(rule.match)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      console.log(`${rule.id}  ${rule.disposition.padEnd(7)}  ${conditions}${rule.label ? `  label=${rule.label}` : ''}  (${rule.source}, ${rule.hits} hits)`);
    }
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
  else if (command === undefined || command === 'help' || command === '--help' || command === '-h') console.log(USAGE);
  else if ((PLANNED as readonly string[]).includes(command)) {
    console.error(`sift ${command} is not implemented yet.`);
    process.exitCode = 1;
  } else {
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exitCode = 2;
  }
}

try {
  await main();
} catch (error) {
  console.error(`sift: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  closeTerminal();
}
