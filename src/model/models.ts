import { type Api, type AuthContext, type Model, type Models, type Provider, createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { vercelAIGatewayProvider } from '@earendil-works/pi-ai/providers/vercel-ai-gateway';
import { type SignIns, credentialStore } from './credentials.ts';

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
const CHATGPT = 'chatgpt';

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
 * Whether to offer a model at all. A reseller lists hundreds; sorting mail wants a small, fast one, so
 * only the major labs' small families are offered, and not a batch variant or a moving "latest" alias.
 */
export function offerModel(provider: string, id: string): boolean {
  if (!RESELLERS.has(provider)) return true;
  return /^(openai\/gpt-[\w.-]*(mini|luna)|anthropic\/claude-haiku|google\/gemini-[\w.-]*flash)/.test(id) && !/batch|latest/.test(id);
}

/** Each provider's small, cheap family, by the word its model ids carry. */
const SMALL_FAMILY: Record<string, string> = {
  openai: 'luna',
  [CHATGPT]: 'luna',
  'openai-codex': 'luna',
  anthropic: 'haiku',
  google: 'flash',
  openrouter: 'haiku',
  'vercel-ai-gateway': 'haiku',
};

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
 * `providers/all` loads every provider's catalog, and a provider nobody can sign in to from sift is only
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
  if (slash <= 0 || slash === spec.length - 1) throw new Error(`The model must look like provider/model-id, not "${spec}".`);
  const model = models.getModel(spec.slice(0, slash), spec.slice(slash + 1));
  if (!model) throw new Error(`Unknown model "${spec}". Choose one in the dashboard, under Settings.`);
  return model;
}

/** A ChatGPT sign-in waiting on the person: the code to enter, and where. */
export interface PendingSignIn {
  code: string;
  url: string;
  expiresAt: number;
  /** Settles when they have entered it and the credential is stored, or rejects when it expired or was refused. */
  done: Promise<void>;
}

/**
 * Start signing in to ChatGPT by device code. Nothing has to come back to this server, so it works
 * wherever the dashboard is opened. Resolves once OpenAI has issued the code.
 */
export async function startChatGPTSignIn(models: Models, deviceId: string, now: () => number = Date.now): Promise<PendingSignIn> {
  let issued = (_: { code: string; url: string; expiresAt: number }) => {};
  const code = new Promise<{ code: string; url: string; expiresAt: number }>((resolve) => (issued = resolve));
  const done = models
    .login(
      'openai-codex',
      'oauth',
      {
        // The browser login needs a callback on this machine; the device code does not.
        prompt: async (prompt) => {
          if (prompt.type === 'select') return 'device_code';
          throw new Error('ChatGPT asked for something sift cannot answer from the dashboard.');
        },
        notify: (event) => {
          if (event.type === 'device_code')
            issued({ code: event.userCode, url: event.verificationUri, expiresAt: now() + (event.expiresInSeconds ?? 900) * 1000 });
        },
      },
      { getDeviceId: () => deviceId },
    )
    .then(() => undefined);
  return { ...(await Promise.race([code, done.then(() => Promise.reject(new Error('ChatGPT finished signing in before giving a code.')))])), done };
}

/** How long a Sign in with ChatGPT waits for the person, holding port 1455 on this machine meanwhile. */
const REDIRECT_WAIT_MS = 10 * 60_000;

/** A Sign in with ChatGPT waiting on the person: where to sign in, and what takes the address they land on. */
export interface PendingRedirect {
  url: string;
  expiresAt: number;
  /** Give it the address the browser was sent back to. */
  finish(address: string): void;
  /** End it unfinished. */
  cancel(): void;
  /** Settles when the credential is stored, or rejects when the address was wrong, it expired or OpenAI refused. */
  done: Promise<void>;
}

/**
 * Start a Sign in with ChatGPT. OpenAI sends the browser back only to 127.0.0.1:1455 on the person's own
 * machine. pi-ai listens there on this one, which finishes it where the browser runs beside sift;
 * anywhere else that page fails to load, and the person pastes its address into the dashboard.
 */
export async function startChatGPTRedirect(models: Models, deviceId: string, now: () => number = Date.now): Promise<PendingRedirect> {
  const expiresAt = now() + REDIRECT_WAIT_MS;
  const cancelled = new AbortController();
  let finish = (_: string) => {};
  const pasted = new Promise<string>((resolve) => (finish = resolve));
  let opened = (_: string) => {};
  const url = new Promise<string>((resolve) => (opened = resolve));
  const done = models
    .login(
      CHATGPT,
      'oauth',
      {
        signal: AbortSignal.any([AbortSignal.timeout(REDIRECT_WAIT_MS), cancelled.signal]),
        // pi-ai races this against its listener and lets go of the port only once both have ended.
        prompt: (prompt) => {
          if (prompt.type !== 'manual_code') return Promise.reject(new Error('ChatGPT asked for something sift cannot answer from the dashboard.'));
          return new Promise<string>((resolve, reject) => {
            prompt.signal?.addEventListener('abort', () => reject(new Error('Login cancelled')), { once: true });
            void pasted.then(resolve);
          });
        },
        notify: (event) => {
          if (event.type === 'auth_url') opened(event.url);
        },
      },
      { getDeviceId: () => deviceId, agentName: 'sift' },
    )
    .then(
      () => undefined,
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message === 'OAuth state mismatch' ? 'That address is from an earlier sign-in. Start again.' : message, { cause: error });
      },
    );
  return {
    url: await Promise.race([url, done.then(() => Promise.reject(new Error('ChatGPT finished signing in before giving an address.')))]),
    expiresAt,
    finish,
    cancel: () => cancelled.abort(),
    done,
  };
}

/** Store an API key for `provider`. */
export async function saveApiKey(signIns: SignIns, provider: string, key: string): Promise<void> {
  await credentialStore(signIns).modify(provider, async () => ({ type: 'api_key', key }));
}
