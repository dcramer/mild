import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Api, AuthEvent, AuthPrompt, Model, Models } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { Config } from '../config.ts';
import { fileCredentialStore } from './credentials.ts';

/** pi-ai's providers, with credentials kept in the data directory. Environment API keys still work when nothing is stored. */
export function openModels(config: Config): Models {
  return builtinModels({ credentials: fileCredentialStore(config.modelAuthPath) });
}

/** Look up a `provider/model-id` spec. Throws a message the user can act on. */
export function resolveModel(models: Models, spec: string): Model<Api> {
  const slash = spec.indexOf('/');
  if (slash <= 0 || slash === spec.length - 1) throw new Error(`The model must look like provider/model-id, not "${spec}".`);
  const model = models.getModel(spec.slice(0, slash), spec.slice(slash + 1));
  if (!model) throw new Error(`Unknown model "${spec}". Run \`sift models\` to list the models you can use.`);
  return model;
}

/** A stable id for this installation, created on first use. Subscription sign-in flows register the device under it. */
function deviceId(config: Config): string {
  const path = config.deviceIdPath;
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const id = randomUUID();
  writeFileSync(path, id, { mode: 0o600 });
  return id;
}

export interface LoginTerminal {
  /** Ask for one line. Resolves early with an empty string if `signal` aborts (the browser callback won the race). */
  ask(question: string, signal?: AbortSignal): Promise<string>;
  say(line: string): void;
}

/**
 * Sign in to a provider and store the credential. `oauth` covers subscription sign-in (for example
 * ChatGPT through `openai` or `openai-codex`); `api_key` stores a key.
 */
export async function login(models: Models, config: Config, provider: string, type: 'oauth' | 'api_key', terminal: LoginTerminal): Promise<void> {
  const prompt = async (p: AuthPrompt): Promise<string> => {
    if (p.type !== 'select') return terminal.ask(p.message, p.signal);
    terminal.say(p.message);
    p.options.forEach((option, index) => terminal.say(`  ${index + 1}. ${option.label}${option.description ? ` (${option.description})` : ''}`));
    for (;;) {
      const answer = await terminal.ask(`Choose 1-${p.options.length}:`, p.signal);
      const chosen = p.options[Number(answer) - 1] ?? p.options.find((option) => option.id === answer);
      if (chosen) return chosen.id;
      if (p.signal?.aborted) throw new Error('Sign-in was cancelled.');
    }
  };
  const notify = (event: AuthEvent) => {
    if (event.type === 'auth_url') terminal.say(`Open this URL in a browser:\n\n${event.url}\n${event.instructions ? `\n${event.instructions}\n` : ''}`);
    else if (event.type === 'device_code') terminal.say(`Go to ${event.verificationUri} and enter the code: ${event.userCode}`);
    else {
      terminal.say(event.message);
      if (event.type === 'info') for (const link of event.links ?? []) terminal.say(`${link.label ?? 'More information'}: ${link.url}`);
    }
  };
  await models.login(provider, type, { prompt, notify }, { getDeviceId: () => deviceId(config) });
}
