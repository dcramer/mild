import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type Api, type AuthEvent, type AuthPrompt, type Model, type Models, createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import type { Config } from '../config.ts';
import { fileCredentialStore } from './credentials.ts';

/**
 * The providers `sift init` offers, with credentials kept in the data directory. Environment API keys
 * still work when nothing is stored. Each is registered by name: pi-ai's `providers/all` loads every
 * provider's catalog, and a provider nobody can sign in to from sift is only more to load and to trust.
 */
export function openModels(config: Config): Models {
  const models = createModels({ credentials: fileCredentialStore(config.modelAuthPath, config.keys) });
  for (const provider of [openaiCodexProvider(), openaiProvider(), anthropicProvider()]) models.setProvider(provider);
  return models;
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
  /** Ask for one line. Resolves with an empty string if `signal` aborts first (the browser callback won the race). */
  text: (question: string, signal?: AbortSignal) => Promise<string>;
  select: (question: string, options: readonly { label: string; hint?: string; value: string }[]) => Promise<string>;
  /** A URL the user must open. */
  link: (url: string) => void;
  info: (line: string) => void;
}

/**
 * Sign in to a provider and store the credential. `oauth` covers subscription sign-in (for example
 * ChatGPT through `openai-codex`); `api_key` stores a key.
 */
export async function login(models: Models, config: Config, provider: string, type: 'oauth' | 'api_key', terminal: LoginTerminal): Promise<void> {
  const prompt = async (p: AuthPrompt): Promise<string> => {
    if (p.type !== 'select') return terminal.text(p.message, p.signal);
    return terminal.select(
      p.message,
      p.options.map((option) => ({ label: option.label, ...(option.description ? { hint: option.description } : {}), value: option.id })),
    );
  };
  const notify = (event: AuthEvent) => {
    if (event.type === 'auth_url') {
      terminal.info('Open this in a browser to sign in:');
      terminal.link(event.url);
    } else if (event.type === 'device_code') {
      terminal.info(`Enter the code ${event.userCode} at:`);
      terminal.link(event.verificationUri);
    } else {
      terminal.info(event.message);
      if (event.type === 'info') for (const link of event.links ?? []) terminal.link(link.url);
    }
  };
  await models.login(provider, type, { prompt, notify }, { getDeviceId: () => deviceId(config) });
}
