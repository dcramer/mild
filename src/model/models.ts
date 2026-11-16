import { type Api, type AuthContext, type Model, type Models, createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { type SignIns, credentialStore } from './credentials.ts';

/** A way to reach a model. `provider` is a pi-ai provider id; `chatgpt` signs in by device code, `key` takes an API key. */
export interface ModelChoice {
  provider: string;
  label: string;
  how: 'chatgpt' | 'key';
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  { provider: 'openai-codex', label: 'ChatGPT', how: 'chatgpt' },
  { provider: 'openai', label: 'OpenAI API key', how: 'key' },
  { provider: 'anthropic', label: 'Anthropic API key', how: 'key' },
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

/** Keys in the environment and files on disk would speak for everyone; each person's sign-in is their own. */
const NOTHING_AMBIENT: AuthContext = { env: async () => undefined, fileExists: async () => false };

/**
 * One person's providers, signed in with what they stored. Each is registered by name: pi-ai's
 * `providers/all` loads every provider's catalog, and a provider nobody can sign in to from sift is only
 * more to load and to trust.
 */
export function openModels(signIns: SignIns): Models {
  const models = createModels({ credentials: credentialStore(signIns), authContext: NOTHING_AMBIENT });
  for (const provider of [openaiCodexProvider(), openaiProvider(), anthropicProvider()]) models.setProvider(provider);
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

/** Store an API key for `provider`. */
export async function saveApiKey(signIns: SignIns, provider: string, key: string): Promise<void> {
  await credentialStore(signIns).modify(provider, async () => ({ type: 'api_key', key }));
}
