import { existsSync, readFileSync } from 'node:fs';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { Config, Env } from '../config.ts';
import { named } from '../env.ts';
import { readSecret, writeSecret } from '../secrets.ts';
import { readProfile } from './api.ts';
import { GMAIL_SCOPES, SEND_SCOPE } from './scopes.ts';

interface ClientSecrets {
  clientId: string;
  clientSecret: string;
}

/** True if the user's Google OAuth client is available, from the home directory or the environment. */
export function hasClientSecrets(config: Config, env: Env = process.env): boolean {
  return Boolean(named(env, 'MILD_GOOGLE_CLIENT_ID') && named(env, 'MILD_GOOGLE_CLIENT_SECRET')) || existsSync(config.googleClientPath);
}

/**
 * Save the user's Google OAuth client into the home directory. `input` is the JSON itself, as pasted
 * from the downloaded file or the console; a path to that file is accepted too. Throws if it is not a
 * Web application client.
 */
export function installClient(config: Config, input: string): void {
  const trimmed = input.trim();
  const text = trimmed.startsWith('{') ? trimmed : readFileSync(trimmed.replace(/^~(?=\/)/, process.env['HOME'] ?? '~'), 'utf8');
  parseClientFile(text, trimmed.startsWith('{') ? 'What you pasted' : trimmed);
  writeSecret(config.googleClientPath, text, config.keys);
}

function parseClientFile(text: string, path: string): ClientSecrets {
  let parsed: { installed?: unknown; web?: { client_id?: string; client_secret?: string } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  if (parsed.installed) throw new Error(`${path} is a Desktop app client. Mild needs a Web application one.`);
  const entry = parsed.web;
  if (!entry?.client_id || !entry.client_secret) throw new Error(`${path} is not a Google OAuth client (it has no "web" entry).`);
  return { clientId: entry.client_id, clientSecret: entry.client_secret };
}

/**
 * The user's own OAuth client: `google-client.json` in the home directory (the file Google
 * Cloud Console downloads; `mild init` puts it there). MILD_GOOGLE_CLIENT_ID and
 * MILD_GOOGLE_CLIENT_SECRET override it when both are set.
 */
export function loadClientSecrets(config: Config, env: Env = process.env): ClientSecrets {
  const clientId = named(env, 'MILD_GOOGLE_CLIENT_ID');
  const clientSecret = named(env, 'MILD_GOOGLE_CLIENT_SECRET');
  if (clientId && clientSecret) return { clientId, clientSecret };
  const text = readSecret(config.googleClientPath, config.keys);
  if (text === null) throw new Error('No Google OAuth client is set up yet. Run `mild init`.');
  return parseClientFile(text, config.googleClientPath);
}

/** An authenticated client for a connected account, from its refresh token. Access tokens are refreshed automatically. */
export function clientFor(secrets: ClientSecrets, refreshToken: string): OAuth2Client {
  const client = new OAuth2Client({ clientId: secrets.clientId, clientSecret: secrets.clientSecret });
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Where to send the browser so Google can sign the user in and grant Mild its Gmail access, in one step. `send`: a connected
 * mailbox to let Mild send from, which Google is asked for that alone, on top of what it has granted.
 */
export function browserSignInUrl(secrets: ClientSecrets, request: { redirectUri: string; state: string; challenge: string; send: string | null }): string {
  return new OAuth2Client({ clientId: secrets.clientId, clientSecret: secrets.clientSecret, redirectUri: request.redirectUri }).generateAuthUrl({
    access_type: 'offline',
    // Always ask, so Google returns a refresh token every time.
    prompt: 'consent',
    scope: request.send === null ? [...GMAIL_SCOPES] : [SEND_SCOPE],
    // Signing in again keeps sending where it was granted, and a grant to send keeps what was granted before it.
    include_granted_scopes: true,
    ...(request.send === null ? {} : { login_hint: request.send }),
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

/** Finish a browser sign-in: exchange the code and find out which account it was. */
export async function completeBrowserSignIn(
  secrets: ClientSecrets,
  request: { redirectUri: string; code: string; verifier: string },
): Promise<{ email: string; historyId: string; refreshToken: string; canSend: boolean }> {
  const client = new OAuth2Client({ clientId: secrets.clientId, clientSecret: secrets.clientSecret, redirectUri: request.redirectUri });
  const { tokens } = await client.getToken({ code: request.code, codeVerifier: request.verifier, redirect_uri: request.redirectUri });
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token.');
  client.setCredentials(tokens);
  const profile = await readProfile(client);
  return {
    email: profile.emailAddress,
    historyId: profile.historyId,
    refreshToken: tokens.refresh_token,
    canSend: (tokens.scope ?? '').split(' ').includes(SEND_SCOPE),
  };
}

/**
 * Revoke a sign-in's grant at Google, which ends Mild's access to the mailbox. A token Google no longer
 * honours counts as revoked. False when Google could not be reached or refused for another reason.
 */
export async function revokeGrant(refreshToken: string): Promise<boolean> {
  try {
    await new OAuth2Client().revokeToken(refreshToken);
    return true;
  } catch (error) {
    return (error as { response?: { status?: number } }).response?.status === 400;
  }
}
