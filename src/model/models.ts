import { type Api, type AuthContext, type Model, type Models, type Provider, createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { vercelAIGatewayProvider } from '@earendil-works/pi-ai/providers/vercel-ai-gateway';
import { registerLazyOAuthFlows } from '@earendil-works/pi-ai/lazy-oauth';
import { type SignIns, credentialStore } from './credentials.ts';
import { Refusal } from '../refusal.ts';
import type { Reasoning } from './reasoning.ts';

/** A person's chosen model, ready to call. */
export interface ChosenModel {
  spec: string;
  models: Models;
  model: Model<Api>;
  reasoning: Reasoning;
}

// Without this pi-ai imports its OAuth flows through a variable specifier, which Vercel's file
// tracing cannot follow, so the function is deployed without them and every refresh fails.
registerLazyOAuthFlows();

/** How an install signs people in to ChatGPT (`chatgptSignIn` in `Settings`). */
export type ChatGPTSignIn = 'device-code' | 'redirect';

/**
 * A way to reach a model. `provider` is a pi-ai provider id. `device-code` and `redirect` are the two
 * ChatGPT sign-ins, of which an install offers one; `key` takes an API key.
 */
export interface ModelChoice {
  provider: string;
  label: string;
  how: ChatGPTSignIn | 'key';
}

/** ChatGPT through Sign in with ChatGPT, under an id of its own so it can sit beside an OpenAI API key. */
export const CHATGPT = 'chatgpt';

/** The ways in this install offers: one ChatGPT sign-in, then the API keys. */
export function modelChoices(chatgpt: ChatGPTSignIn): ModelChoice[] {
  return [
    { provider: chatgpt === 'redirect' ? CHATGPT : 'openai-codex', label: 'ChatGPT', how: chatgpt },
    { provider: 'openai', label: 'OpenAI API key', how: 'key' },
    { provider: 'anthropic', label: 'Anthropic API key', how: 'key' },
    { provider: 'openrouter', label: 'OpenRouter API key', how: 'key' },
    { provider: 'vercel-ai-gateway', label: 'Vercel AI Gateway API key', how: 'key' },
  ];
}

/** Providers that resell many labs' models. Their ids carry the lab: `anthropic/claude-haiku-5.5`. */
const RESELLERS = new Set(['openrouter', 'vercel-ai-gateway']);

/**
 * Whether to offer a model at all. A reseller lists hundreds; classifying mail wants a small, fast one, so
 * only the major labs' small families are offered, and not a batch variant or a moving "latest" alias.
 */
export function offerModel(provider: string, id: string): boolean {
  if (!RESELLERS.has(provider)) return true;
  return /^(openai\/gpt-[\w.-]*(mini|luna)|anthropic\/claude-haiku|google\/gemini-[\w.-]*flash)/.test(id) && !/batch|latest/.test(id);
}

/**
 * Each provider's families worth classifying mail with, cheapest first, by the word their model ids carry.
 * The first is the one to suggest; the rest are there for someone who wants a stronger model.
 */
const FAMILIES: Record<string, readonly string[]> = {
  openai: ['luna', 'terra', 'sol'],
  [CHATGPT]: ['luna', 'terra', 'sol'],
  'openai-codex': ['luna', 'terra', 'sol'],
  anthropic: ['haiku', 'sonnet', 'opus'],
  google: ['flash', 'pro'],
  openrouter: ['haiku', 'luna', 'flash'],
  'vercel-ai-gateway': ['haiku', 'luna', 'flash'],
};

/** The numbers in a model id up to the first that is a date (`3-5` in `claude-3-5-haiku-20241022`). */
const version = (id: string) => {
  const numbers = (id.match(/\d+/g) ?? []).map(Number);
  const date = numbers.findIndex((n) => n >= 1000);
  return date === -1 ? numbers : numbers.slice(0, date);
};

/** Newer first; between ids of the same version the shortest, which is the plain name over a dated or variant one. */
const newer = (a: string, b: string) => {
  const [va, vb] = [version(a), version(b)];
  for (let i = 0; i < Math.max(va.length, vb.length); i++) if ((va[i] ?? -1) !== (vb[i] ?? -1)) return (vb[i] ?? -1) - (va[i] ?? -1);
  return a.length - b.length;
};

/**
 * The models to offer before the full list: the newest of each of the provider's families among the ids it
 * returned, cheapest family first, so the first is the one to suggest. Empty for a provider Mild knows no
 * families of.
 */
export function shortlistModels(provider: string, ids: readonly string[]): string[] {
  return (FAMILIES[provider] ?? []).flatMap((family) => {
    const word = new RegExp(`(^|[^a-z])${family}([^a-z]|$)`, 'i');
    const newest = ids.filter((id) => word.test(id)).toSorted(newer)[0];
    return newest ? [newest] : [];
  });
}

/**
 * A classifying call, in tokens, as a catalog price is per million of them. In: a body cut at 4,000
 * characters (about 1,000 tokens), examples up to 1,200 (`SHOT_TOKEN_BUDGET`), and the instructions and
 * labels. Out: a label and a reason of at most 300 characters.
 */
const TYPICAL_CALL: Tokens = { input: 3000, output: 150 };

export interface Tokens {
  input: number;
  output: number;
}

/** What one call of `tokens` costs at a model's catalog price, in dollars; null when the catalog has no price. */
export function priceOf(cost: { input: number; output: number }, tokens: Tokens = TYPICAL_CALL): number | null {
  const each = (tokens.input * cost.input + tokens.output * cost.output) / 1_000_000;
  return each > 0 ? each : null;
}

/** Keys in the environment and files on disk would speak for everyone; each person's sign-in is their own. */
const NOTHING_AMBIENT: AuthContext = { env: async () => undefined, fileExists: async () => false };

/**
 * pi-ai's OpenAI provider, signed in with ChatGPT only. pi-ai recognises a ChatGPT token (and leaves out
 * the request fields OpenAI refuses with one) only on a model whose provider is `openai`, so each call
 * goes out as that provider's; the models and the sign-in stay under `chatgpt`.
 */
function chatgptProvider(): Provider {
  const openai: Provider = openaiProvider();
  const models = openai.getModels().map((model) => ({ ...model, provider: CHATGPT }));
  const asOpenAI = (model: Model<Api>) => ({ ...model, provider: openai.id });
  return {
    id: CHATGPT,
    name: 'ChatGPT',
    baseUrl: openai.baseUrl,
    auth: { oauth: openai.auth.oauth },
    getModels: () => models,
    stream: (model, context, options) => openai.stream(asOpenAI(model), context, options),
    streamSimple: (model, context, options) => openai.streamSimple(asOpenAI(model), context, options),
  };
}

/**
 * One person's providers, signed in with what they stored. Each is registered by name: pi-ai's
 * `providers/all` loads every provider's catalog, and a provider nobody can sign in to from Mild is only
 * more to load and to trust. Only the install's own ChatGPT sign-in is registered, so a sign-in kept from
 * the other is not used.
 */
export function openModels(signIns: SignIns, chatgpt: ChatGPTSignIn): Models {
  const models = createModels({ credentials: credentialStore(signIns), authContext: NOTHING_AMBIENT });
  const viaChatGPT = chatgpt === 'redirect' ? chatgptProvider() : openaiCodexProvider();
  for (const provider of [viaChatGPT, openaiProvider(), anthropicProvider(), openrouterProvider(), vercelAIGatewayProvider()]) models.setProvider(provider);
  return models;
}

/** Look up a `provider/model-id` spec. Throws a message the user can act on. */
export function resolveModel(models: Models, spec: string): Model<Api> {
  const slash = spec.indexOf('/');
  if (slash <= 0 || slash === spec.length - 1) throw new Refusal(`The model must look like provider/model-id, not "${spec}".`);
  const model = models.getModel(spec.slice(0, slash), spec.slice(slash + 1));
  if (!model) throw new Refusal(`Unknown model "${spec}". Choose one in the dashboard, under Settings.`);
  return model;
}

/** Store an API key for `provider`. */
export async function saveApiKey(signIns: SignIns, provider: string, key: string): Promise<void> {
  await credentialStore(signIns).modify(provider, async () => ({ type: 'api_key', key }));
}
