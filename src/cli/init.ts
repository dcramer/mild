import { existsSync, writeFileSync } from 'node:fs';
import { type Config, GUIDELINES_TEMPLATE, type Settings } from '../config.ts';
import type { Category } from '../triage/stages/model.ts';

export interface Terminal {
  /** Ask for one line. */
  ask: (question: string) => Promise<string>;
  say: (line: string) => void;
}

/** A way to reach a model. `provider` is a pi-ai provider id. */
export interface ModelChoice {
  label: string;
  provider: string;
  type: 'oauth' | 'api_key';
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  { label: 'ChatGPT Plus or Pro subscription (Codex)', provider: 'openai-codex', type: 'oauth' },
  { label: 'OpenAI API key', provider: 'openai', type: 'api_key' },
  { label: 'Anthropic API key', provider: 'anthropic', type: 'api_key' },
];

/** What the wizard needs from the rest of sift. Everything that touches the network or the disk is injected. */
export interface InitDeps {
  config: Config;
  terminal: Terminal;
  saveSettings(settings: Settings): void;
  hasGoogleClient(): boolean;
  /** Copy a downloaded client file into the home directory. Throws a readable message if it is the wrong file. */
  installGoogleClient(path: string): void;
  connectedAccounts(): string[];
  /** Run the Gmail sign-in. Resolves with the connected address. */
  connectGmail(): Promise<string>;
  loginModel(choice: ModelChoice): Promise<void>;
  /** Model ids the signed-in provider offers. */
  availableModels(provider: string): Promise<string[]>;
  categories(account: string): Category[];
}

const GOOGLE_CLIENT_STEPS = `sift reads your mail through a Google OAuth client that you own, so nobody else sits in between.
  1. In Google Cloud Console (https://console.cloud.google.com/), create a project and enable the Gmail API.
  2. Set up the OAuth consent screen: External, with the scopes gmail.modify and gmail.settings.basic,
     and publish it ("In production"). Left in "Testing", Google expires your sign-in every 7 days.
  3. Create an OAuth client of type "Desktop app" and download its JSON file.`;

async function choose<T>(terminal: Terminal, question: string, options: readonly T[], label: (option: T) => string, skip: string): Promise<T | null> {
  options.forEach((option, index) => terminal.say(`  ${index + 1}. ${label(option)}`));
  terminal.say(`  ${options.length + 1}. ${skip}`);
  for (;;) {
    const answer = await terminal.ask(`${question} [1-${options.length + 1}]`);
    const n = Number(answer);
    if (answer === '' || n === options.length + 1) return null;
    const chosen = options[n - 1];
    if (Number.isInteger(n) && chosen !== undefined) return chosen;
    terminal.say(`Enter a number from 1 to ${options.length + 1}.`);
  }
}

/**
 * Walk the user through whatever is not set up yet, in order: home directory, Google client, Gmail
 * account, model, preferences. Each step checks the real state first, so running it again only asks
 * about what is still missing, and any step can be skipped and done later.
 */
export async function runInit(deps: InitDeps): Promise<void> {
  const { config, terminal } = deps;
  const { say, ask } = terminal;
  const done = (text: string) => say(`  done  ${text}`);

  say(`sift keeps everything in ${config.home}`);
  if (!existsSync(config.settingsPath)) deps.saveSettings(config.settings);
  if (!existsSync(config.guidelinesPath)) writeFileSync(config.guidelinesPath, GUIDELINES_TEMPLATE, { mode: 0o600 });
  done('settings in sift.toml, guidance in guidelines.md');

  say('\nStep 1 of 4: Google OAuth client');
  if (deps.hasGoogleClient()) done('client is in place');
  else {
    say(GOOGLE_CLIENT_STEPS);
    for (;;) {
      const path = await ask('Path to the downloaded JSON file (or press Enter to do this later):');
      if (path === '') break;
      try {
        deps.installGoogleClient(path.replace(/^~(?=\/)/, process.env['HOME'] ?? '~'));
        done('client saved');
        break;
      } catch (error) {
        say(`That did not work: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  say('\nStep 2 of 4: Gmail account');
  let accounts = deps.connectedAccounts();
  if (accounts.length > 0) done(`connected: ${accounts.join(', ')}`);
  else if (!deps.hasGoogleClient()) say('  skipped: this needs the Google client from step 1.');
  else {
    try {
      const email = await deps.connectGmail();
      accounts = [email];
      done(`connected ${email}. sift handles mail that arrives from now on.`);
    } catch (error) {
      say(`Sign-in did not finish: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  say('\nStep 3 of 4: Model');
  if (config.settings.model) done(`using ${config.settings.model}`);
  else {
    say('Rules and learned senders decide mail for free. A model can decide what they do not cover;');
    say('without one, that mail is left in your inbox for you.');
    const choice = await choose(terminal, 'How should sift reach a model?', MODEL_CHOICES, (c) => c.label, 'No model for now');
    if (choice) await pickModel(deps, choice);
  }

  say('\nStep 4 of 4: Preferences');
  const [account] = accounts;
  if (account === undefined) say('  skipped: connect an account first.');
  else {
    say('This is what sift does with each kind of mail the model identifies:');
    for (const c of deps.categories(account)) say(`  ${c.name.padEnd(26)} ${c.disposition}${c.label ? `, label ${c.label}` : ''}`);
    say('Change one with:  sift categories set <key> --do <keep|archive|review|spam>   (list keys with `sift categories`)');
    say(`Write anything else that helps sort your mail in ${config.guidelinesPath}`);
  }

  say('');
  const missing = [deps.hasGoogleClient() ? null : 'the Google client', accounts.length > 0 ? null : 'a Gmail account'].filter((item) => item !== null);
  if (missing.length > 0) {
    say(`Not finished: ${missing.join(' and ')}. Run \`sift init\` again when you are ready.`);
    return;
  }
  say('Ready. sift starts by observing: it records what it would do and changes nothing in Gmail.');
  say('  sift run          start syncing and deciding');
  say('  sift dashboard    see what it decided and why');
  say(`When you trust it, set act = true in ${config.settingsPath} (or run \`sift run --act\`).`);
}

async function pickModel(deps: InitDeps, choice: ModelChoice): Promise<void> {
  const { terminal, config } = deps;
  try {
    await deps.loginModel(choice);
  } catch (error) {
    terminal.say(`Sign-in did not finish: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  let models: string[] = [];
  try {
    models = await deps.availableModels(choice.provider);
  } catch {
    models = [];
  }

  let id: string | null;
  if (models.length === 0) {
    id = (await terminal.ask('Signed in, but the provider did not list its models. Model id to use (or Enter to skip):')) || null;
  } else {
    terminal.say('Signed in. Which model? A smaller, cheaper one is usually enough to sort mail.');
    id = await choose(terminal, 'Model', models, (m) => m, 'Decide later');
  }
  if (id === null) {
    terminal.say(`  No model chosen. Set one later in ${config.settingsPath}; \`sift models\` lists them.`);
    return;
  }
  deps.saveSettings({ ...config.settings, model: `${choice.provider}/${id}` });
  terminal.say(`  done  using ${choice.provider}/${id}`);
}
