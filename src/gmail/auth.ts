import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { Config } from '../config.ts';
import { GMAIL_SCOPES } from './scopes.ts';

export interface ClientSecrets {
  clientId: string;
  clientSecret: string;
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
  let parsed: { installed?: { client_id?: string; client_secret?: string } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  const installed = parsed.installed;
  if (!installed?.client_id || !installed.client_secret) {
    throw new Error(`${path} is not a Desktop app client (it has no "installed" entry). Create the client with application type "Desktop app".`);
  }
  return { clientId: installed.client_id, clientSecret: installed.client_secret };
}

/**
 * The user's own Desktop OAuth client: `google-client.json` in the home directory (the file Google
 * Cloud Console downloads; `sift init` puts it there). SIFT_GOOGLE_CLIENT_ID and
 * SIFT_GOOGLE_CLIENT_SECRET override it when both are set.
 */
export function loadClientSecrets(config: Config, env: NodeJS.ProcessEnv = process.env): ClientSecrets {
  const clientId = env['SIFT_GOOGLE_CLIENT_ID'];
  const clientSecret = env['SIFT_GOOGLE_CLIENT_SECRET'];
  if (clientId && clientSecret) return { clientId, clientSecret };
  if (!existsSync(config.googleClientPath)) throw new Error('No Google OAuth client is set up yet. Run `sift init`.');
  return parseClientFile(readFileSync(config.googleClientPath, 'utf8'), config.googleClientPath);
}

/** Extract the authorization code from a redirect URL (or its path and query), checking `state`. */
export function parseCallback(url: string, expectedState: string): string {
  const params = new URL(url.trim(), 'http://127.0.0.1').searchParams;
  const error = params.get('error');
  if (error) throw new Error(`Google refused authorization: ${error}`);
  if (params.get('state') !== expectedState) throw new Error('OAuth state mismatch; start again with `sift auth`.');
  const code = params.get('code');
  if (!code) throw new Error('The redirect URL has no authorization code.');
  return code;
}

export interface AuthorizeOptions {
  /** Loopback port. 0 picks a free one; set a fixed port when publishing it from a container. */
  port?: number;
  /** Interface to listen on. Use 0.0.0.0 inside a container; the redirect URI is always 127.0.0.1. */
  host?: string;
  /** Called once with the URL the user must open. */
  onUrl: (url: string) => void;
  /** Resolves with a redirect URL the user pasted, for machines whose browser cannot reach the loopback port. */
  pasted?: Promise<string>;
}

/** Run the installed-app flow (loopback redirect, PKCE S256). Returns a refresh token. */
export async function authorize(secrets: ClientSecrets, options: AuthorizeOptions): Promise<{ refreshToken: string; client: OAuth2Client }> {
  const state = randomBytes(16).toString('hex');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });

  try {
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const client = new OAuth2Client({ clientId: secrets.clientId, clientSecret: secrets.clientSecret, redirectUri });
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    if (!codeChallenge) throw new Error('Could not create a PKCE challenge');

    const fromBrowser = new Promise<string>((resolve, reject) => {
      server.on('request', (req, res) => {
        const url = req.url ?? '/';
        if (!url.includes('code=') && !url.includes('error=')) {
          res.writeHead(404).end();
          return;
        }
        try {
          resolve(parseCallback(url, state));
          res.writeHead(200, { 'content-type': 'text/plain' }).end('Authorization received. Return to the terminal to confirm sift connected.');
        } catch (error) {
          res.writeHead(400, { 'content-type': 'text/plain' }).end('Authorization failed. Return to the terminal.');
          reject(error);
        }
      });
    });
    const fromPaste = options.pasted?.then((url) => parseCallback(url, state));

    options.onUrl(
      client.generateAuthUrl({
        access_type: 'offline',
        // Force the consent screen so Google returns a refresh token even if this client was authorized before.
        prompt: 'consent',
        scope: [...GMAIL_SCOPES],
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      }),
    );

    const code = await (fromPaste ? Promise.race([fromBrowser, fromPaste]) : fromBrowser);
    const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token.');
    client.setCredentials(tokens);
    return { refreshToken: tokens.refresh_token, client };
  } finally {
    server.close();
    server.closeAllConnections();
  }
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
  if (!existsSync(path)) throw new Error(`No token for ${email}. Run \`sift auth\`.`);
  const { refresh_token } = JSON.parse(readFileSync(path, 'utf8')) as { refresh_token?: string };
  if (!refresh_token) throw new Error(`Token file for ${email} is invalid. Run \`sift auth\` again.`);
  const client = new OAuth2Client({ clientId: secrets.clientId, clientSecret: secrets.clientSecret });
  client.setCredentials({ refresh_token });
  return client;
}
