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

/** What the wizard needs from the rest of sift. Everything that touches the network or the disk is injected. */
export interface InitDeps {
  config: Config;
  ui: Ui;
  saveSettings(settings: Settings): void;
  hasGoogleClient(): boolean;
  /** Save the pasted client JSON into the home directory. Throws a readable message if it is the wrong kind. */
  installGoogleClient(json: string): void;
  connectedAccounts(): string[];
  /** Run the Gmail sign-in. Resolves with the connected address. */
  connectGmail(): Promise<string>;
  loginModel(choice: ModelChoice): Promise<void>;
  /** Model ids the signed-in provider offers. */
  availableModels(provider: string): Promise<string[]>;
  categories(account: string): Category[];
}

const STEPS = 4;
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

  ui.step(1, STEPS, 'Google OAuth client');
  if (deps.hasGoogleClient()) ui.ok('In place');
  else await googleClient(deps);

  ui.step(2, STEPS, 'Gmail account');
  let accounts = deps.connectedAccounts();
  if (accounts.length > 0) ui.ok(`Connected ${paint.bold(accounts.join(', '))}`);
  else if (!deps.hasGoogleClient()) ui.skip('Needs the Google client from step 1');
  else {
    try {
      const email = await deps.connectGmail();
      accounts = [email];
      ui.ok(`Connected ${paint.bold(email)}`);
      ui.info('Only mail that arrives from now on is sorted.');
    } catch (error) {
      ui.fail(`Sign-in did not finish: ${reason(error)}`);
    }
  }

  ui.step(3, STEPS, 'Model');
  if (config.settings.model) ui.ok(`Using ${paint.bold(config.settings.model)}`);
  else {
    ui.info('Sorts mail that no rule or learned sender covers. Without one, that mail stays in your inbox.');
    ui.blank();
    const choice = await ui.select<ModelChoice | null>('How should sift reach a model?', [
      ...MODEL_CHOICES.map((c) => ({ label: c.label, ...(c.hint ? { hint: c.hint } : {}), value: c })),
      { label: 'No model for now', value: null },
    ]);
    if (choice) await pickModel(deps, choice);
    else ui.skip('No model');
  }

  ui.step(4, STEPS, 'Preferences');
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
  const missing = [deps.hasGoogleClient() ? null : 'the Google client', accounts.length > 0 ? null : 'a Gmail account'].filter((item) => item !== null);
  if (missing.length > 0) {
    ui.warn(`Still needed: ${missing.join(' and ')}. Run ${paint.cmd('sift init')} again.`);
    ui.blank();
    return;
  }
  ui.plain(`${paint.mark(' Ready ')} Start with ${paint.cmd('sift run')}, watch with ${paint.cmd('sift dashboard')}.`);
  ui.blank();
  ui.info(`sift only observes until you set act = true in ${paint.path(config.settingsPath)}`);
  ui.blank();
}

interface Task {
  title: string;
  url: string;
  /** What to do there, in order. */
  todo: readonly string[];
  /** Exact values to enter, when the page is a form. */
  values?: readonly (readonly [string, string])[];
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
    todo: ['Create the client, then choose "Download JSON". sift asks for its contents at the end.'],
    values: [
      ['Application type', 'Desktop app'],
      ['Name', 'sift'],
    ],
  },
  {
    title: 'Allow access to Gmail',
    url: 'https://console.cloud.google.com/auth/scopes',
    todo: ['Choose "Add or remove scopes".', 'Paste both scopes below into "Manually add scopes", then Add to table, Update and Save.'],
    values: [
      ['Scopes', 'https://www.googleapis.com/auth/gmail.modify'],
      ['', 'https://www.googleapis.com/auth/gmail.settings.basic'],
    ],
  },
  {
    title: 'Publish the app',
    url: 'https://console.cloud.google.com/auth/audience',
    todo: [
      'Choose "Publish app" and confirm, so the status reads "In production".',
      'Left in "Testing", Google ends your sign-in every 7 days. It needs no review for your own use;',
      'when you sign in you will see "Google hasn\'t verified this app": choose Advanced, then continue.',
    ],
  },
];

/** Returns once the client is saved or the user has chosen to leave it for later. */
async function googleClient(deps: InitDeps): Promise<void> {
  const { ui } = deps;
  ui.info('sift reads your mail through a Google client that you own, so nobody sits in between.');

  ui.blank();

  // One task on screen at a time: each folds into a single done line when the user comes back.
  for (const [index, task] of GOOGLE_TASKS.entries()) {
    ui.mark();
    ui.plain(`${paint.bold(task.title)}  ${paint.dim(`${index + 1} of ${GOOGLE_TASKS.length}`)}`);
    ui.link(task.url);
    ui.blank();
    for (const item of task.todo) ui.info(item);
    if (task.values) {
      ui.blank();
      ui.fields(task.values);
    }
    ui.blank();
    if (!(await ui.pause())) {
      ui.skip('Stopped here');
      return;
    }
    ui.collapse(task.title);
  }

  ui.blank();
  for (;;) {
    const pasted = await ui.pasteJson('Paste the downloaded JSON (Enter to skip):');
    if (pasted === '') {
      ui.skip('Skipped');
      return;
    }
    try {
      deps.installGoogleClient(pasted);
      ui.ok('Client saved');
      return;
    } catch (error) {
      ui.fail(reason(error));
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
