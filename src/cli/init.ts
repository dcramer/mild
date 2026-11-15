import { existsSync, writeFileSync } from 'node:fs';
import { type Config, GUIDELINES_TEMPLATE, type Settings } from '../config.ts';
import type { Category } from '../triage/stages/model.ts';
import { type Ui, disposition, paint } from './ui.ts';

/** A way to reach a model. `provider` is a pi-ai provider id. */
export interface ModelChoice {
  label: string;
  hint?: string;
  provider: string;
  type: 'oauth' | 'api_key';
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  { label: 'ChatGPT subscription', hint: 'Plus or Pro, signs in like Codex', provider: 'openai-codex', type: 'oauth' },
  { label: 'OpenAI API key', provider: 'openai', type: 'api_key' },
  { label: 'Anthropic API key', provider: 'anthropic', type: 'api_key' },
];

/** Who may sign in to the user's Google app. Decides the last tasks of the Google setup. */
export type Access = 'test' | 'publish';

export interface SetupState {
  /** Google setup tasks finished, counted along the path `access` selects. */
  googleTasks: number;
  access?: Access;
  /** Whether the dashboard is opened on this machine or from another. Unset until the user has said. */
  location?: 'local' | 'remote';
}

/** What the wizard needs from the rest of sift. Everything that touches the network or the disk is injected. */
export interface InitDeps {
  config: Config;
  ui: Ui;
  saveSettings(settings: Settings): void;
  hasGoogleClient(): boolean;
  /** How far the Google setup has got, so a later run resumes where this one stopped. */
  setupState(): SetupState;
  saveSetupState(state: SetupState): void;
  /** Save the pasted client JSON into the home directory. Throws a readable message if it is the wrong kind. */
  installGoogleClient(json: string): void;
  connectedAccounts(): string[];
  /** Run the Gmail sign-in. Resolves with the connected address. */
  connectGmail(): Promise<string>;
  loginModel(choice: ModelChoice): Promise<void>;
  /** Model ids the signed-in provider offers. */
  availableModels(provider: string): Promise<string[]>;
  categories(account: string): Category[];
  /** Addresses on this machine that another machine could reach. */
  networkAddresses(): { address: string; label: string }[];
  /** Where a browser finds the dashboard under the current settings, best first. */
  dashboardUrls(): string[];
}

const STEPS = 5;
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Walk the user through whatever is not set up yet, in order: Google client, Gmail account, model,
 * preferences. Each step checks the real state first, so running it again only asks about what is
 * still missing, and any step can be skipped and done later.
 */
export async function runInit(deps: InitDeps): Promise<void> {
  const { config, ui } = deps;

  ui.heading('setup', paint.path(config.home));
  if (!existsSync(config.settingsPath)) deps.saveSettings(config.settings);
  if (!existsSync(config.guidelinesPath)) writeFileSync(config.guidelinesPath, GUIDELINES_TEMPLATE, { mode: 0o600 });

  ui.step(1, STEPS, 'Where sift runs');
  if (deps.setupState().location === undefined || (await keep(ui, whereDashboard(deps), 'Change it'))) await chooseLocation(deps);

  ui.step(2, STEPS, 'Google OAuth client');
  if (googleReady(deps)) {
    if (await keep(ui, 'Client in place', 'Set it up again')) {
      const { location } = deps.setupState();
      deps.saveSetupState({ googleTasks: 0, ...(location ? { location } : {}) });
      await googleClient(deps);
    }
  } else await googleClient(deps);

  ui.step(3, STEPS, 'Gmail account');
  let accounts = deps.connectedAccounts();
  if (!googleReady(deps)) ui.skip('Needs step 2 finished');
  else if (accounts.length === 0 || (await keep(ui, `Connected ${paint.bold(accounts.join(', '))}`, 'Connect another account'))) {
    try {
      const email = await deps.connectGmail();
      accounts = deps.connectedAccounts();
      ui.ok(`Connected ${paint.bold(email)}`);
      ui.info('Only mail that arrives from now on is sorted.');
    } catch (error) {
      ui.fail(`Sign-in did not finish: ${reason(error)}`);
    }
  }

  ui.step(4, STEPS, 'Model');
  if (!config.settings.model || (await keep(ui, `Using ${paint.bold(config.settings.model)}`, 'Change it'))) {
    ui.info('Sorts mail that no rule or learned sender covers. Without one, that mail stays in your inbox.');
    ui.blank();
    const choice = await ui.select<ModelChoice | null>('How should sift reach a model?', [
      ...MODEL_CHOICES.map((c) => ({ label: c.label, ...(c.hint ? { hint: c.hint } : {}), value: c })),
      { label: 'No model for now', value: null },
    ]);
    if (choice) await pickModel(deps, choice);
    else ui.skip('No model');
  }

  ui.step(5, STEPS, 'Preferences');
  const [account] = accounts;
  if (account === undefined) ui.skip('Needs a connected account');
  else {
    ui.table(
      ['Kind', 'sift will', 'Label'],
      deps.categories(account).map((c) => [c.name, disposition(c.disposition), c.label ?? '']),
    );
    ui.blank();
    ui.info(`Change one with ${paint.cmd('sift categories set <key> --do <keep|archive|review|spam>')}`);
    ui.info(`Anything else goes in ${paint.path(config.guidelinesPath)}, in your own words`);
  }

  ui.blank();
  const missing = [googleReady(deps) ? null : 'the Google client', accounts.length > 0 ? null : 'a Gmail account'].filter((item) => item !== null);
  if (missing.length > 0) {
    ui.warn(`Still needed: ${missing.join(' and ')}. Run ${paint.cmd('sift init')} again.`);
    ui.blank();
    return;
  }
  ui.plain(`${paint.mark(' Ready ')} Start it with ${paint.cmd('sift run')}. The dashboard is at ${paint.bold(deps.dashboardUrls()[0] ?? '')}`);
  ui.blank();
  ui.info(`sift only observes until you set act = true in ${paint.path(config.settingsPath)}`);
  ui.blank();
}

/**
 * A step that is already done: show it, and let the user go on with Enter or redo it. Returns true to redo.
 */
async function keep(ui: Ui, done: string, redo: string): Promise<boolean> {
  ui.mark();
  const again = await ui.select(done, [
    { label: 'Keep it', value: false },
    { label: redo, value: true },
  ]);
  if (!again) ui.collapse(done);
  return again;
}

const whereDashboard = (deps: InitDeps) =>
  deps.config.settings.dashboardHost ? `Dashboard at ${paint.bold(deps.dashboardUrls()[0] ?? '')}` : 'Dashboard on this machine only';

/** Ask whether the dashboard is opened here or from another machine, and if so where it should listen. */
async function chooseLocation(deps: InitDeps): Promise<void> {
  const { ui, config } = deps;
  const remote = await ui.select('Where will you open the dashboard?', [
    { label: 'On this machine', value: false },
    { label: 'From another machine', hint: 'sift runs on a server', value: true },
  ]);

  let host: string | undefined;
  if (remote) {
    ui.info('The dashboard has no login: anyone on a network it listens on can read it.');
    ui.blank();
    const addresses = deps.networkAddresses();
    host = await ui.select('Which network should it listen on?', [
      ...addresses.map((a) => ({ label: a.address, hint: a.label, value: a.address })),
      { label: 'All of them', hint: addresses.length === 0 ? 'no addresses found yet' : 'every network this machine is on', value: 'all' },
    ]);
  }

  const { dashboardHost: _previous, ...rest } = config.settings;
  deps.saveSettings(host ? { ...rest, dashboardHost: host } : rest);
  deps.saveSetupState({ ...deps.setupState(), location: host ? 'remote' : 'local' });
  ui.ok(whereDashboard(deps));
  for (const url of deps.dashboardUrls().slice(1)) ui.info(`also ${url}`);
}

interface Task {
  title: string;
  url: string;
  /** What to do there, in order. */
  todo: readonly string[];
  /** Exact values to enter, when the page is a form. */
  values?: readonly (readonly [string, string])[];
  /** This task ends with the client's JSON, which is pasted here. */
  collectsClient?: boolean;
}

/** Creating the Google client, one page at a time. Google renames these screens now and then; the links go straight to each. */
const GOOGLE_TASKS: readonly Task[] = [
  {
    title: 'Create a project',
    url: 'https://console.cloud.google.com/projectcreate',
    todo: ['Create it, then make sure it is the project selected in the bar at the top.'],
  },
  {
    title: 'Enable the Gmail API',
    url: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
    todo: ['Choose Enable.'],
  },
  {
    title: 'Set up the consent screen',
    url: 'https://console.cloud.google.com/auth/overview',
    todo: ['Choose Get started and fill in the form, then Create.'],
    values: [
      ['App name', 'sift'],
      ['User support email', 'your own address'],
      ['Audience', 'External'],
      ['Contact information', 'your own address'],
    ],
  },
  {
    title: 'Create the client',
    url: 'https://console.cloud.google.com/auth/clients',
    todo: ['Create the client, then choose "Download JSON".'],
    collectsClient: true,
    values: [
      ['Application type', 'Desktop app'],
      ['Name', 'sift'],
    ],
  },
  {
    title: 'Allow access to Gmail',
    url: 'https://console.cloud.google.com/auth/scopes',
    todo: [
      'Open "Data Access" in the left menu, then choose "Add or remove scopes".',
      'Paste both scopes below into "Manually add scopes", then Add to table, Update and Save.',
    ],
    values: [
      ['Scopes', 'https://www.googleapis.com/auth/gmail.modify'],
      ['', 'https://www.googleapis.com/auth/gmail.settings.basic'],
    ],
  },
];

/** The last tasks, after choosing who may sign in. */
const ACCESS_TASKS: Record<Access, readonly Task[]> = {
  test: [
    {
      title: 'Add yourself as a test user',
      url: 'https://console.cloud.google.com/auth/audience',
      todo: ['Under "Test users", choose "Add users" and enter the Gmail address sift will read.'],
    },
  ],
  publish: [
    {
      title: 'Fill in the branding',
      url: 'https://console.cloud.google.com/auth/branding',
      todo: ['Publishing needs every required field here. Save when done.'],
    },
    {
      title: 'Publish the app',
      url: 'https://console.cloud.google.com/auth/audience',
      todo: [
        'Choose "Publish app" and confirm, so the publishing status reads "In production".',
        'Google may then ask you to verify the app before it lets you sign in.',
      ],
    },
  ],
};

const tasksFor = (access: Access | undefined) => [...GOOGLE_TASKS, ...(access ? ACCESS_TASKS[access] : [])];

/** True once the client is saved and every task on the chosen path is done. */
function googleReady(deps: InitDeps): boolean {
  const state = deps.setupState();
  return deps.hasGoogleClient() && state.access !== undefined && state.googleTasks >= tasksFor(state.access).length;
}

/**
 * The Google setup, from wherever the saved state says it had reached. State is saved after every task,
 * so stopping part-way and running `sift init` again carries on from the same place.
 */
async function googleClient(deps: InitDeps): Promise<void> {
  const { ui } = deps;
  const state = { ...deps.setupState() };
  if (state.googleTasks === 0) {
    ui.info('sift reads your mail through a Google client that you own, so nobody sits in between.');
    ui.blank();
  }

  // One task on screen at a time: each folds into a single done line when the user comes back.
  for (;;) {
    if (state.googleTasks >= GOOGLE_TASKS.length && state.access === undefined) {
      // Google only lets an app's test users or, once it is published, everyone sign in.
      const access = await ui.select<Access>('Who signs in to this app?', [
        { label: 'Just me, as a test user', hint: 'works straight away; Google signs you out every 7 days', value: 'test' },
        { label: 'Publish the app', hint: 'no weekly sign-out; Google may require verification first', value: 'publish' },
      ]);
      state.access = access;
      deps.saveSetupState({ ...state });
    }
    const tasks = tasksFor(state.access);
    const task = tasks[state.googleTasks];
    if (!task) return;

    ui.mark();
    ui.plain(`${paint.bold(task.title)}  ${paint.dim(`${state.googleTasks + 1} of ${state.access ? tasks.length : `${tasks.length}+`}`)}`);
    ui.link(task.url);
    ui.blank();
    for (const item of task.todo) ui.info(item);
    if (task.values) {
      ui.blank();
      ui.fields(task.values);
    }
    ui.blank();
    const finished = task.collectsClient ? await pasteClient(deps) : await ui.pause();
    if (!finished) {
      ui.skip('Stopped here');
      return;
    }
    state.googleTasks += 1;
    deps.saveSetupState({ ...state });
    ui.collapse(task.title);
  }
}

/** Ask for the client JSON until it is accepted. False if the user stops. */
async function pasteClient(deps: InitDeps): Promise<boolean> {
  for (;;) {
    const pasted = await deps.ui.pasteJson('Paste the JSON here (s to stop):');
    if (pasted === '' || /^s(top|kip)?$/i.test(pasted)) return false;
    try {
      deps.installGoogleClient(pasted);
      return true;
    } catch (error) {
      deps.ui.fail(reason(error));
    }
  }
}

async function pickModel(deps: InitDeps, choice: ModelChoice): Promise<void> {
  const { ui, config } = deps;
  try {
    await deps.loginModel(choice);
  } catch (error) {
    ui.fail(`Sign-in did not finish: ${reason(error)}`);
    return;
  }

  let models: string[] = [];
  try {
    models = await ui.spin('Listing models', () => deps.availableModels(choice.provider));
  } catch {
    models = [];
  }

  let id: string | null;
  if (models.length === 0) id = (await ui.text('Model id (Enter to skip):')) || null;
  else {
    ui.info('A smaller, cheaper model is usually enough to sort mail.');
    id = await ui.select<string | null>('Which model?', [...models.map((m) => ({ label: m, value: m })), { label: 'Decide later', value: null }]);
  }
  if (id === null) {
    ui.skip('No model');
    return;
  }
  deps.saveSettings({ ...config.settings, model: `${choice.provider}/${id}` });
  ui.ok(`Using ${paint.bold(`${choice.provider}/${id}`)}`);
}
