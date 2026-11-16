import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { type Config, type Settings, isAddress } from '../config.ts';
import { type Ui, paint } from './ui.ts';

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
  /** Save the key as SIFT_KEY where sift will read it, and use it from now on. Returns the file. Throws if it cannot be written. */
  saveKey(key: string): string;
  hasGoogleClient(): boolean;
  /** How far setup has got, so a later run resumes where this one stopped. */
  setupState(): SetupState;
  saveSetupState(state: SetupState): void;
  /** Save the pasted client JSON into the home directory. Throws a readable message if it is the wrong kind. */
  installGoogleClient(json: string): void;
  connectedAccounts(): Promise<string[]>;
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
    title: 'Encryption key',
    missing: () => !deps.config.keys.current,
    value: () =>
      deps.config.keys.current ? `Credentials encrypted${paint.dim(` · key ${deps.config.keys.current.id}`)}` : paint.dim('none, credentials stored plain'),
    run: () => createKey(deps),
  },
  {
    title: 'Where sift runs',
    missing: () => deps.setupState().location === undefined,
    value: () => `Dashboard at ${paint.bold(dashboardAddress(deps))}`,
    run: () => chooseLocation(deps),
  },
  {
    title: 'Google OAuth client',
    missing: () => !googleReady(deps),
    value: () => `Client in place${paint.dim(deps.setupState().access === 'test' ? ' · for test users' : ' · published')}`,
    run: async () => {
      if (!googleReady(deps)) return googleClient(deps);
      const { location } = deps.setupState();
      deps.saveSetupState({ googleTasks: 0, ...(location ? { location } : {}) });
      return googleClient(deps);
    },
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

  const all = steps(deps);
  const accounts = await deps.connectedAccounts();
  // The key and the sign-in list are optional, so they do not keep a finished setup in the walk-through.
  if (all.slice(1, 3).some((step) => step.missing())) {
    for (const [index, step] of all.entries()) {
      ui.step(index + 1, STEPS, step.title);
      if (step.missing()) await step.run();
      else ui.ok(step.value());
    }
    ui.step(STEPS, STEPS, 'Gmail account');
    if (accounts.length > 0) ui.ok(`Connected ${paint.bold(accounts.join(', '))}`);
    else if (!googleReady(deps)) ui.skip('Needs step 3 finished');
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

/**
 * Generate the key that encrypts stored credentials, before any are stored. It goes in `.env` where init
 * runs, not in the home, so a copy of the home does not carry its own key.
 */
async function createKey(deps: InitDeps): Promise<void> {
  const { ui } = deps;
  if (deps.config.keys.current) {
    ui.info(
      `A key is set. Replacing it needs the old one kept as ${paint.cmd('SIFT_OLD_KEYS')} until sift run has re-encrypted everything: see docs/SECRETS.md.`,
    );
    return;
  }
  const key = randomBytes(32).toString('base64url');
  let path: string;
  try {
    path = deps.saveKey(key);
  } catch (error) {
    ui.fail(`Could not save the key: ${reason(error)}`);
    ui.info(`Set this as ${paint.cmd('SIFT_KEY')} wherever sift runs, then run sift init again:`);
    ui.plain(key);
    return;
  }
  ui.ok(`Saved as ${paint.cmd('SIFT_KEY')} in ${paint.path(path)}`);
  ui.info('sift reads it only when started from this directory, and cannot open your credentials without it. Keep a copy somewhere else.');
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
    const shut = (await deps.connectedAccounts()).filter((account) => !entered.includes(account.toLowerCase()));
    if (shut.length > 0) ui.warn(`${shut.join(', ')} ${shut.length === 1 ? 'is' : 'are'} connected but can no longer sign in. sift still reads that mail.`);
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
  {
    title: 'Create the client',
    url: 'https://console.cloud.google.com/auth/clients',
    todo: ['Create the client with the redirect URIs below, then choose "Download JSON".'],
    collectsClient: true,
    values: [
      ['Application type', 'Web application'],
      ['Name', 'sift'],
      ...redirectUris(deps).map((uri, index) => [index === 0 ? 'Authorised redirect URIs' : '', uri] as const),
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
