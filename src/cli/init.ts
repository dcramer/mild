import { existsSync, writeFileSync } from 'node:fs';
import { type Config, GUIDELINES_TEMPLATE, type Settings, isAddress } from '../config.ts';
import { type Ui, paint } from './ui.ts';

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

/** Each provider's small, cheap family, by the word its model ids carry. */
const SMALL_FAMILY: Record<string, string> = { openai: 'luna', 'openai-codex': 'luna', anthropic: 'haiku', google: 'flash' };

/** The numbers in a model id up to the first that is a date (`3-5` in `claude-3-5-haiku-20241022`). */
const version = (id: string) => {
  const numbers = (id.match(/\d+/g) ?? []).map(Number);
  const date = numbers.findIndex((n) => n >= 1000);
  return date === -1 ? numbers : numbers.slice(0, date);
};

/**
 * The model to offer first: the newest of the provider's small family among the ids it returned, or
 * null when it has none. Between ids of the same version the shortest wins, which is the plain name
 * over a dated or variant one.
 */
export function recommendModel(provider: string, ids: readonly string[]): string | null {
  const family = SMALL_FAMILY[provider];
  if (!family) return null;
  const word = new RegExp(`(^|[^a-z])${family}([^a-z]|$)`, 'i');
  const newer = (a: string, b: string) => {
    const [va, vb] = [version(a), version(b)];
    for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] ?? -1) !== (vb[i] ?? -1)) return (vb[i] ?? -1) - (va[i] ?? -1);
    return a.length - b.length;
  };
  return ids.filter((id) => word.test(id)).toSorted(newer)[0] ?? null;
}

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
  /** `desktop` is a client from an older setup, which has to be replaced. */
  googleClientKind(): 'web' | 'desktop' | null;
  /** How far setup has got, so a later run resumes where this one stopped. */
  setupState(): SetupState;
  saveSetupState(state: SetupState): void;
  /** Save the pasted client JSON into the home directory. Throws a readable message if it is the wrong kind. */
  installGoogleClient(json: string): void;
  connectedAccounts(): string[];
  loginModel(choice: ModelChoice): Promise<void>;
  /** Model ids the signed-in provider offers. */
  availableModels(provider: string): Promise<string[]>;
  /** This machine's Tailscale name, or null without Tailscale. */
  tailscaleName(): string | null;
  /** Serve the dashboard over HTTPS on the tailnet (`tailscale serve`). Rejects with what went wrong. */
  enableTailscaleServe(port: number): Promise<void>;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Where the user opens the dashboard: the Tailscale HTTPS name on a server, localhost otherwise. */
function dashboardAddress(deps: InitDeps): string {
  const name = deps.setupState().location === 'remote' ? deps.tailscaleName() : null;
  return name ? `https://${name}` : `http://localhost:${deps.config.settings.dashboardPort}`;
}

interface Step {
  title: string;
  /** Nothing has been chosen for it yet, so a first run stops here. */
  missing(): boolean;
  /** What is set now, for the list of steps. */
  value(): string;
  /** Do the step, or do it again if it is done. */
  run(): Promise<void>;
}

const steps = (deps: InitDeps): Step[] => [
  {
    title: 'Where sift runs',
    missing: () => deps.setupState().location === undefined,
    value: () => `Dashboard at ${paint.bold(dashboardAddress(deps))}`,
    run: () => chooseLocation(deps),
  },
  {
    title: 'Google OAuth client',
    missing: () => !googleReady(deps) || deps.googleClientKind() === 'desktop',
    value: () => `Client in place${paint.dim(deps.setupState().access === 'test' ? ' · for test users' : ' · published')}`,
    run: async () => {
      if (!googleReady(deps)) return googleClient(deps);
      if (deps.googleClientKind() === 'desktop') {
        deps.ui.warn('Your client is a Desktop app client. Signing in from the dashboard needs a Web application one.');
        return replaceClient(deps);
      }
      const { location } = deps.setupState();
      deps.saveSetupState({ googleTasks: 0, ...(location ? { location } : {}) });
      return googleClient(deps);
    },
  },
  {
    title: 'Model',
    missing: () => !deps.config.settings.model,
    value: () => deps.config.settings.model ?? paint.dim('none'),
    run: () => chooseModel(deps),
  },
  {
    title: 'Who can sign in',
    missing: () => !deps.config.settings.dashboardAllow,
    value: () => deps.config.settings.dashboardAllow?.join(', ') ?? paint.dim('no limit'),
    run: () => chooseAllowed(deps),
  },
];
/** The steps above, then the Gmail account, which is connected in the browser. */
const STEPS = 5;

/**
 * Set sift up. A first run walks through every step, and one that was stopped part-way carries on with
 * what is missing. Once the dashboard has an address and the Google client is finished, it lists the
 * steps as they stand and redoes the one the user picks. The Gmail account itself is connected in the
 * browser, by signing in to the dashboard.
 */
export async function runInit(deps: InitDeps): Promise<void> {
  const { config, ui } = deps;

  ui.heading('setup', paint.path(config.home));
  if (!existsSync(config.settingsPath)) deps.saveSettings(config.settings);
  if (!existsSync(config.guidelinesPath)) writeFileSync(config.guidelinesPath, GUIDELINES_TEMPLATE, { mode: 0o600 });

  const all = steps(deps);
  const accounts = deps.connectedAccounts();
  // The model and the sign-in list are optional, so they do not keep a finished setup in the walk-through.
  if (all.slice(0, 2).some((step) => step.missing())) {
    for (const [index, step] of all.entries()) {
      ui.step(index + 1, STEPS, step.title);
      if (step.missing()) await step.run();
      else ui.ok(step.value());
    }
    ui.step(STEPS, STEPS, 'Gmail account');
    if (accounts.length > 0) ui.ok(`Connected ${paint.bold(accounts.join(', '))}`);
    else if (!googleReady(deps)) ui.skip('Needs step 2 finished');
    else ui.info('Connected in the browser: signing in to the dashboard with Google is what connects the account.');
  } else {
    ui.fields([
      ...all.map((step) => [step.title, step.value()] as const),
      ['Gmail account', accounts.length > 0 ? accounts.join(', ') : paint.dim('connected by signing in to the dashboard')],
    ]);
    ui.blank();
    const step = await ui.select<Step | null>('Change a step?', [{ label: 'No', value: null }, ...all.map((step) => ({ label: step.title, value: step }))]);
    if (step) {
      ui.step(all.indexOf(step) + 1, STEPS, step.title);
      await step.run();
    }
  }

  ui.blank();
  if (!googleReady(deps)) {
    ui.warn(`Still needed: the Google client. Run ${paint.cmd('sift init')} again.`);
    ui.blank();
    return;
  }
  ui.plain(
    `${paint.mark(' Ready ')} Start it with ${paint.cmd('sift run')}, then open ${paint.bold(dashboardAddress(deps))}${accounts.length === 0 ? ' and sign in with Google' : ''}.`,
  );
  ui.blank();
}

async function chooseModel(deps: InitDeps): Promise<void> {
  const { ui } = deps;
  ui.info('Sorts mail that no rule or learned sender covers. Without one, that mail stays in your inbox.');
  ui.blank();
  const choice = await ui.select<ModelChoice | null>('How should sift reach a model?', [
    ...MODEL_CHOICES.map((c) => ({ label: c.label, ...(c.hint ? { hint: c.hint } : {}), value: c })),
    { label: 'No model for now', value: null },
  ]);
  if (choice) return pickModel(deps, choice);
  const { model: _old, ...settings } = deps.config.settings;
  deps.saveSettings(settings);
  ui.skip('No model');
}

/**
 * Ask whether the dashboard is opened here or from another machine. From another machine it has to be
 * HTTPS, because Google will not sign anyone in over plain HTTP except at localhost; Tailscale provides that.
 */
async function chooseLocation(deps: InitDeps): Promise<void> {
  const { ui, config } = deps;
  const remote = await ui.select('Where will you open the dashboard?', [
    { label: 'On this machine', value: false },
    { label: 'From another machine', hint: 'sift runs on a server', value: true },
  ]);
  const { dashboardHost: _unused, ...settings } = config.settings;
  deps.saveSettings(settings);
  deps.saveSetupState({ ...deps.setupState(), location: remote ? 'remote' : 'local' });
  if (!remote) return ui.ok(`Dashboard at ${paint.bold(dashboardAddress(deps))}`);

  const name = deps.tailscaleName();
  if (!name) {
    ui.warn('Google only signs people in at localhost or an HTTPS address, and this machine has no Tailscale name to provide one.');
    ui.info('Install Tailscale here and run sift init again, or reach localhost through an SSH tunnel.');
    return;
  }
  ui.info('Google only signs people in over HTTPS, which Tailscale provides for your own devices.');
  const serve = `tailscale serve --bg ${config.settings.dashboardPort}`;
  if (
    await ui.select(`Run ${paint.cmd(serve)} now?`, [
      { label: 'Yes', value: true },
      { label: 'I will do it myself', value: false },
    ])
  ) {
    try {
      await ui.spin('Turning on Tailscale serve', () => deps.enableTailscaleServe(config.settings.dashboardPort));
    } catch (error) {
      ui.fail(reason(error));
      ui.info(`Run it yourself, with sudo if it asks: ${paint.cmd(serve)}`);
    }
  }
  ui.ok(`Dashboard at ${paint.bold(dashboardAddress(deps))}`);
}

/** Limit sign-in to listed Google accounts, or leave it to whoever signs in first. */
async function chooseAllowed(deps: InitDeps): Promise<void> {
  const { ui, config } = deps;
  ui.info('Signing in to the dashboard with Google connects that account. Without a list, the first account to sign in connects itself.');
  for (;;) {
    const entered = (await ui.text('Addresses allowed to sign in, separated by commas (Enter for no limit):'))
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter((address) => address !== '');
    const wrong = entered.find((address) => !isAddress(address));
    if (wrong !== undefined) {
      ui.fail(`${wrong} is not an email address.`);
      continue;
    }
    const { dashboardAllow: _old, ...settings } = config.settings;
    deps.saveSettings({ ...settings, ...(entered.length > 0 ? { dashboardAllow: entered } : {}) });
    if (entered.length === 0) return ui.skip('No limit');
    ui.ok(`Only ${paint.bold(entered.join(', '))}`);
    const shut = deps.connectedAccounts().filter((account) => !entered.includes(account.toLowerCase()));
    if (shut.length > 0) ui.warn(`${shut.join(', ')} ${shut.length === 1 ? 'is' : 'are'} connected but can no longer sign in. sift still sorts that mail.`);
    return;
  }
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

/** The addresses Google must be told it may send a signed-in browser back to. */
function redirectUris(deps: InitDeps): string[] {
  const name = deps.tailscaleName();
  return [`http://localhost:${deps.config.settings.dashboardPort}/auth/callback`, ...(name ? [`https://${name}/auth/callback`] : [])];
}

const clientTask = (deps: InitDeps): Task => ({
  title: 'Create the client',
  url: 'https://console.cloud.google.com/auth/clients',
  todo: ['Create the client with the redirect URIs below, then choose "Download JSON".'],
  collectsClient: true,
  values: [
    ['Application type', 'Web application'],
    ['Name', 'sift'],
    ...redirectUris(deps).map((uri, index) => [index === 0 ? 'Authorised redirect URIs' : '', uri] as const),
  ],
});

/** Creating the Google client, one page at a time. Google renames these screens now and then; the links go straight to each. */
const googleTasks = (deps: InitDeps): Task[] => [
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
  clientTask(deps),
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
const COMMON_TASKS = 5;

/** The last tasks, after choosing who may sign in. */
const ACCESS_TASKS: Record<Access, readonly Task[]> = {
  test: [
    {
      title: 'Add yourself as a test user',
      url: 'https://console.cloud.google.com/auth/audience',
      todo: ['Under "Test users", choose "Add users" and enter each Gmail address sift will read.'],
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

const tasksFor = (deps: InitDeps, access: Access | undefined) => [...googleTasks(deps), ...(access ? ACCESS_TASKS[access] : [])];

/** True once the client is saved and every task on the chosen path is done. */
function googleReady(deps: InitDeps): boolean {
  const state = deps.setupState();
  return deps.hasGoogleClient() && state.access !== undefined && state.googleTasks >= tasksFor(deps, state.access).length;
}

/** Show one task and wait until it is done. False if the user stops. */
async function doTask(deps: InitDeps, task: Task, position: string): Promise<boolean> {
  const { ui } = deps;
  ui.mark();
  ui.plain(`${paint.bold(task.title)}  ${paint.dim(position)}`);
  ui.link(task.url);
  ui.blank();
  for (const item of task.todo) ui.info(item);
  if (task.values) {
    ui.blank();
    ui.fields(task.values);
  }
  ui.blank();
  const finished = task.collectsClient ? await pasteClient(deps) : await ui.pause();
  if (finished) ui.collapse(task.title);
  else ui.skip('Stopped here');
  return finished;
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
    if (state.googleTasks >= COMMON_TASKS && state.access === undefined) {
      // Google only lets an app's test users or, once it is published, everyone sign in.
      state.access = await ui.select<Access>('Who signs in to this app?', [
        { label: 'Just me, as a test user', hint: 'works straight away; Google signs you out every 7 days', value: 'test' },
        { label: 'Publish the app', hint: 'no weekly sign-out; Google may require verification first', value: 'publish' },
      ]);
      deps.saveSetupState({ ...state });
    }
    const tasks = tasksFor(deps, state.access);
    const task = tasks[state.googleTasks];
    if (!task) return;
    if (!(await doTask(deps, task, `${state.googleTasks + 1} of ${state.access ? tasks.length : `${tasks.length}+`}`))) return;
    state.googleTasks += 1;
    deps.saveSetupState({ ...state });
  }
}

/** Swap the client for a new one in the same project. The project's other settings carry over. */
async function replaceClient(deps: InitDeps): Promise<void> {
  await doTask(deps, clientTask(deps), 'replacing the client');
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
    const recommended = recommendModel(choice.provider, models);
    id = await ui.select<string | null>('Which model?', [
      ...(recommended ? [{ label: recommended, hint: 'recommended', value: recommended }] : []),
      ...models.filter((m) => m !== recommended).map((m) => ({ label: m, value: m })),
      { label: 'Decide later', value: null },
    ]);
  }
  if (id === null) {
    ui.skip('No model');
    return;
  }
  deps.saveSettings({ ...config.settings, model: `${choice.provider}/${id}` });
  ui.ok(`Using ${paint.bold(`${choice.provider}/${id}`)}`);
}
