import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { Config } from '../config.ts';
import { createGmailApi } from './api.ts';
import { GMAIL_SCOPES } from './scopes.ts';

export interface ClientSecrets {
  clientId: string;
  clientSecret: string;
  /**
   * `web`: can sign in from the dashboard at any address registered on the client, including an HTTPS one.
   * `desktop`: only from an address on this machine (localhost).
   */
  kind: 'web' | 'desktop';
}

const tokenFile = (config: Config, email: string) => join(config.googleTokenDir, `${encodeURIComponent(email)}.json`);

/** True if the user's Google OAuth client is available, from the home directory or the environment. */
export function hasClientSecrets(config: Config, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['SIFT_GOOGLE_CLIENT_ID'] && env['SIFT_GOOGLE_CLIENT_SECRET']) || existsSync(config.googleClientPath);
}

/**
 * Save the user's Google OAuth client into the home directory. `input` is the JSON itself, as pasted
 * from the downloaded file or the console; a path to that file is accepted too. Throws if it is not a
 * Desktop client.
 */
export function installClient(config: Config, input: string): void {
  const trimmed = input.trim();
  const text = trimmed.startsWith('{') ? trimmed : readFileSync(trimmed.replace(/^~(?=\/)/, process.env['HOME'] ?? '~'), 'utf8');
  parseClientFile(text, trimmed.startsWith('{') ? 'What you pasted' : trimmed);
  writeFileSync(config.googleClientPath, text, { mode: 0o600 });
  chmodSync(config.googleClientPath, 0o600);
}

function parseClientFile(text: string, path: string): ClientSecrets {
  let parsed: { installed?: { client_id?: string; client_secret?: string }; web?: { client_id?: string; client_secret?: string } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  const entry = parsed.web ?? parsed.installed;
  if (!entry?.client_id || !entry.client_secret) throw new Error(`${path} is not a Google OAuth client (it has no "web" or "installed" entry).`);
  return { clientId: entry.client_id, clientSecret: entry.client_secret, kind: parsed.web ? 'web' : 'desktop' };
}

/**
 * The user's own Desktop OAuth client: `google-client.json` in the home directory (the file Google
 * Cloud Console downloads; `sift init` puts it there). SIFT_GOOGLE_CLIENT_ID and
 * SIFT_GOOGLE_CLIENT_SECRET override it when both are set.
 */
export function loadClientSecrets(config: Config, env: NodeJS.ProcessEnv = process.env): ClientSecrets {
  const clientId = env['SIFT_GOOGLE_CLIENT_ID'];
  const clientSecret = env['SIFT_GOOGLE_CLIENT_SECRET'];
  if (clientId && clientSecret) return { clientId, clientSecret, kind: 'web' };
  if (!existsSync(config.googleClientPath)) throw new Error('No Google OAuth client is set up yet. Run `sift init`.');
  return parseClientFile(readFileSync(config.googleClientPath, 'utf8'), config.googleClientPath);
}

/** Tokens live in files, not the database, so the database can be copied or inspected without exposing them. */
export function saveRefreshToken(config: Config, email: string, refreshToken: string): void {
  const path = tokenFile(config, email);
  mkdirSync(config.googleTokenDir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ refresh_token: refreshToken }), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** An authenticated client for a connected account. Access tokens are refreshed automatically. */
export function clientFor(config: Config, secrets: ClientSecrets, email: string): OAuth2Client {
  const path = tokenFile(config, email);
  if (!existsSync(path)) throw new Error(`sift has no access to ${email}. Sign in to the dashboard with that account.`);
  const { refresh_token } = JSON.parse(readFileSync(path, 'utf8')) as { refresh_token?: string };
  if (!refresh_token) throw new Error(`The stored access for ${email} is unreadable. Sign in to the dashboard with that account again.`);
  const client = new OAuth2Client({ clientId: secrets.clientId, clientSecret: secrets.clientSecret });
  client.setCredentials({ refresh_token });
  return client;
}

/** Where to send the browser so Google can sign the user in and grant sift its Gmail access, in one step. */
export function browserSignInUrl(secrets: ClientSecrets, request: { redirectUri: string; state: string; challenge: string }): string {
  return new OAuth2Client({ clientId: secrets.clientId, clientSecret: secrets.clientSecret, redirectUri: request.redirectUri }).generateAuthUrl({
    access_type: 'offline',
    // Always ask, so Google returns a refresh token every time.
    prompt: 'consent',
    scope: [...GMAIL_SCOPES],
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}

/** Finish a browser sign-in: exchange the code and find out which account it was. */
export async function completeBrowserSignIn(
  secrets: ClientSecrets,
  request: { redirectUri: string; code: string; verifier: string },
): Promise<{ email: string; historyId: string; refreshToken: string }> {
  const client = new OAuth2Client({ clientId: secrets.clientId, clientSecret: secrets.clientSecret, redirectUri: request.redirectUri });
  const { tokens } = await client.getToken({ code: request.code, codeVerifier: request.verifier, redirect_uri: request.redirectUri });
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token.');
  client.setCredentials(tokens);
  const profile = await createGmailApi(client).getProfile();
  return { email: profile.emailAddress, historyId: profile.historyId, refreshToken: tokens.refresh_token };
}
