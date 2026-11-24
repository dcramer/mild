import { type SignIns, credentialStore } from './credentials.ts';
import { CHATGPT } from './models.ts';
import { Refusal } from '../refusal.ts';
import { tracedFetch } from '../telemetry.ts';

/** Codex's device-code sign-in, as pi-ai's `openai-codex` login does it, so the credential is the one pi-ai refreshes. */
const DEVICE = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  userCode: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
  poll: 'https://auth.openai.com/api/accounts/deviceauth/token',
  verify: 'https://auth.openai.com/codex/device',
  token: 'https://auth.openai.com/oauth/token',
  redirect: 'https://auth.openai.com/deviceauth/callback',
};
const DEVICE_CODE_MS = 15 * 60_000;

/** A ChatGPT device-code sign-in waiting on the person: what they are shown, and what asking about it takes. Plain data, kept between requests. */
export interface DeviceCode {
  code: string;
  url: string;
  expiresAt: number;
  intervalMs: number;
  deviceAuthId: string;
}

/** Ask OpenAI for a code for the person to enter. Nothing has to come back to this server, so it works wherever the dashboard is. */
export async function startChatGPTDeviceCode(now: () => number = Date.now): Promise<DeviceCode> {
  const response = await tracedFetch(DEVICE.userCode, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: DEVICE.clientId }),
  });
  if (!response.ok) throw new Refusal(`OpenAI would not give a sign-in code (${response.status}).`);
  const body = (await response.json()) as Record<string, unknown>;
  const interval = Number(body['interval']);
  if (typeof body['device_auth_id'] !== 'string' || typeof body['user_code'] !== 'string' || !Number.isFinite(interval) || interval < 0)
    throw new Refusal('OpenAI answered with a sign-in code Mild cannot use.');
  return { code: body['user_code'], url: DEVICE.verify, expiresAt: now() + DEVICE_CODE_MS, intervalMs: interval * 1000, deviceAuthId: body['device_auth_id'] };
}

/**
 * Ask OpenAI once whether the person has entered the code. When they have, store the sign-in as pi-ai's own
 * login would. `slow down` asks for a longer wait before the next question. Throws with what went wrong.
 */
export async function pollChatGPTDeviceCode(signIns: SignIns, device: DeviceCode, now: () => number = Date.now): Promise<'waiting' | 'slow down' | 'done'> {
  if (now() > device.expiresAt) throw new Refusal('That code expired. Start again.');
  const response = await tracedFetch(DEVICE.poll, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_auth_id: device.deviceAuthId, user_code: device.code }),
  });
  if (response.status === 403 || response.status === 404) return 'waiting';
  if (!response.ok) {
    const error = ((await response.json().catch(() => ({}))) as { error?: string | { code?: string } }).error;
    const code = typeof error === 'object' ? error.code : error;
    if (code === 'deviceauth_authorization_pending') return 'waiting';
    if (code === 'slow_down') return 'slow down';
    throw new Refusal(`OpenAI refused the sign-in (${response.status}). Start again.`);
  }
  const granted = (await response.json()) as Record<string, unknown>;
  if (typeof granted['authorization_code'] !== 'string' || typeof granted['code_verifier'] !== 'string')
    throw new Error('OpenAI answered the sign-in with something Mild cannot use.');
  const exchanged = await tracedFetch(DEVICE.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: DEVICE.clientId,
      code: granted['authorization_code'],
      code_verifier: granted['code_verifier'],
      redirect_uri: DEVICE.redirect,
    }),
  });
  if (!exchanged.ok) throw new Error(`OpenAI refused the sign-in (${exchanged.status}). Start again.`);
  const token = (await exchanged.json()) as Record<string, unknown>;
  const { access_token: access, refresh_token: refresh, expires_in: expiresIn } = token;
  const accountId = typeof access === 'string' ? chatgptAccount(access) : null;
  if (typeof access !== 'string' || typeof refresh !== 'string' || typeof expiresIn !== 'number' || !accountId)
    throw new Error('OpenAI answered the sign-in with something Mild cannot use.');
  await credentialStore(signIns).modify('openai-codex', async () => ({ type: 'oauth', access, refresh, expires: now() + expiresIn * 1000, accountId }));
  return 'done';
}

/** The ChatGPT account an access token is for, from its claims, as pi-ai reads it. */
function chatgptAccount(access: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString()) as Record<string, { chatgpt_account_id?: unknown } | undefined>;
    const id = claims['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
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

/** A Sign in with ChatGPT waiting on the person: where to sign in, and what finishing it takes. Plain data, kept between requests. */
export interface PendingRedirect {
  url: string;
  expiresAt: number;
  state: string;
  verifier: string;
}

/**
 * Start a Sign in with ChatGPT. OpenAI sends the browser back only to 127.0.0.1:1455 on the person's own
 * machine, and Mild listens on no port for it: wherever the browser is, that page fails to load, and the
 * person pastes its address into `finishChatGPTRedirect`.
 */
export async function startChatGPTRedirect(deviceId: string, now: () => number = Date.now): Promise<PendingRedirect> {
  const verifier = randomText();
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const state = randomText();
  const url = new URL(SIGN_IN.authorize);
  url.search = new URLSearchParams({
    client_id: 'dynamic_agent_client',
    agent_name_hint: 'Mild',
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
  return { url: url.toString(), expiresAt: now() + REDIRECT_WAIT_MS, state, verifier };
}

/**
 * Finish with the address the browser was sent back to, storing the sign-in as pi-ai's own would be, so
 * pi-ai refreshes it. Rejects with what to do when the address is not the one, or OpenAI refused; until it
 * expires, opening `url` again gives a new address the same sign-in takes.
 */
export async function finishChatGPTRedirect(signIns: SignIns, pending: PendingRedirect, address: string, now: () => number = Date.now): Promise<void> {
  if (now() > pending.expiresAt) throw new Refusal('That sign-in expired. Start again.');
  let back: URL;
  try {
    back = new URL(address);
  } catch {
    throw new Refusal("Paste the whole address from the browser's address bar.");
  }
  if (`${back.origin}${back.pathname}` !== SIGN_IN.redirect)
    throw new Refusal(`That is not the address ChatGPT sent you to, which starts ${SIGN_IN.redirect}.`);
  const refused = back.searchParams.get('error');
  if (refused) throw new Refusal(`ChatGPT did not sign you in (${refused}).`);
  if (back.searchParams.get('state') !== pending.state) throw new Refusal('That address is from an earlier sign-in. Open ChatGPT from here again.');
  const code = back.searchParams.get('code');
  const clientId = back.searchParams.get('client_id');
  if (!code || !clientId) throw new Refusal('That address is missing part of what ChatGPT sent. Copy all of it.');

  const response = await tracedFetch(SIGN_IN.token, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: SIGN_IN.redirect,
      resource: SIGN_IN.resource,
    }),
  });
  if (!response.ok) throw new Refusal(`OpenAI refused the sign-in (${response.status}). Open ChatGPT again.`);
  const token = (await response.json()) as Record<string, unknown>;
  const scopes = typeof token['scope'] === 'string' ? token['scope'].split(/\s+/).filter(Boolean) : [];
  const { access_token: access, refresh_token: refresh, expires_in: expiresIn } = token;
  if (typeof access !== 'string' || typeof refresh !== 'string' || typeof expiresIn !== 'number')
    throw new Refusal('OpenAI answered the sign-in with something Mild cannot use.');
  if (!scopes.includes('chatgpt.tokens.use.direct')) throw new Refusal('ChatGPT did not allow Mild to use your plan. Open ChatGPT again and allow it.');
  await credentialStore(signIns).modify(CHATGPT, async () => ({
    type: 'oauth',
    access,
    refresh,
    expires: now() + expiresIn * 1000 - EXPIRY_MARGIN_MS,
    clientId,
    scopes,
  }));
}
