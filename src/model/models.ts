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
interface PendingSignIn {
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
  const code = Promise.withResolvers<{ code: string; url: string; expiresAt: number }>();
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
            code.resolve({ code: event.userCode, url: event.verificationUri, expiresAt: now() + (event.expiresInSeconds ?? 900) * 1000 });
        },
      },
      { getDeviceId: () => deviceId },
    )
    .then(() => undefined);
  return { ...(await Promise.race([code.promise, done.then(() => Promise.reject(new Error('ChatGPT finished signing in before giving a code.')))])), done };
}

/** Sign in with ChatGPT, as OpenAI documents it for open-source apps: no client secret, and a client registered by each sign-in. */
const SIGN_IN = {
  authorize: 'https://auth.openai.com/api/accounts/authorize',
  token: 'https://auth.openai.com/api/accounts/oauth/token',
  /** The only address OpenAI sends the browser back to. Nothing listens there: the person pastes it. */
  redirect: 'http://127.0.0.1:1455/auth/callback',
  resource: 'https://api.openai.com/v1',
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
};
/** How long a Sign in with ChatGPT waits for the address. */
const REDIRECT_WAIT_MS = 10 * 60_000;
/** pi-ai refreshes a token this long before it expires; a credential stored here keeps to the same. */
const EXPIRY_MARGIN_MS = 3 * 60_000;

const randomText = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/** A Sign in with ChatGPT waiting on the person: where to sign in, and what takes the address they land on. */
export interface PendingRedirect {
  url: string;
  expiresAt: number;
  /**
   * Finish with the address the browser was sent back to, storing the sign-in. Rejects with what to do
   * when the address is not the one, or OpenAI refused; until it expires, opening `url` again gives a
   * new address this sign-in takes.
   */
  finish(address: string): Promise<void>;
}

/**
 * Start a Sign in with ChatGPT. OpenAI sends the browser back only to 127.0.0.1:1455 on the person's own
 * machine, and sift listens on no port for it: wherever the browser is, that page fails to load, and the
 * person pastes its address. The sign-in is stored as pi-ai's own would be, so pi-ai refreshes it.
 */
export async function startChatGPTRedirect(signIns: SignIns, deviceId: string, now: () => number = Date.now): Promise<PendingRedirect> {
  const verifier = randomText();
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const state = randomText();
  const expiresAt = now() + REDIRECT_WAIT_MS;
  const url = new URL(SIGN_IN.authorize);
  url.search = new URLSearchParams({
    client_id: 'dynamic_agent_client',
    agent_name_hint: 'sift',
    ext_agent_host_id: `urn:uuid:${deviceId.toLowerCase()}`,
    response_type: 'code',
    redirect_uri: SIGN_IN.redirect,
    resource: SIGN_IN.resource,
    scope: SIGN_IN.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    nonce: randomText(),
  }).toString();

  const finish = async (address: string) => {
    if (now() > expiresAt) throw new Error('That sign-in expired. Start again.');
    let back: URL;
    try {
      back = new URL(address);
    } catch {
      throw new Error("Paste the whole address from the browser's address bar.");
    }
    if (`${back.origin}${back.pathname}` !== SIGN_IN.redirect)
      throw new Error(`That is not the address ChatGPT sent you to, which starts ${SIGN_IN.redirect}.`);
    const refused = back.searchParams.get('error');
    if (refused) throw new Error(`ChatGPT did not sign you in (${refused}).`);
    if (back.searchParams.get('state') !== state) throw new Error('That address is from an earlier sign-in. Open ChatGPT from here again.');
    const code = back.searchParams.get('code');
    const clientId = back.searchParams.get('client_id');
    if (!code || !clientId) throw new Error('That address is missing part of what ChatGPT sent. Copy all of it.');

    const response = await fetch(SIGN_IN.token, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: SIGN_IN.redirect,
        resource: SIGN_IN.resource,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI refused the sign-in (${response.status}). Open ChatGPT again.`);
    const token = (await response.json()) as Record<string, unknown>;
    const scopes = typeof token['scope'] === 'string' ? token['scope'].split(/\s+/).filter(Boolean) : [];
    const { access_token: access, refresh_token: refresh, expires_in: expiresIn } = token;
    if (typeof access !== 'string' || typeof refresh !== 'string' || typeof expiresIn !== 'number')
      throw new Error('OpenAI answered the sign-in with something sift cannot use.');
    if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT did not allow sift to use your plan. Open ChatGPT again and allow it.');
    await credentialStore(signIns).modify(CHATGPT, async () => ({
      type: 'oauth',
      access,
      refresh,
      expires: now() + expiresIn * 1000 - EXPIRY_MARGIN_MS,
      clientId,
      scopes,
    }));
  };
  return { url: url.toString(), expiresAt, finish };
}

/** Store an API key for `provider`. */
export async function saveApiKey(signIns: SignIns, provider: string, key: string): Promise<void> {
  await credentialStore(signIns).modify(provider, async () => ({ type: 'api_key', key }));
}
