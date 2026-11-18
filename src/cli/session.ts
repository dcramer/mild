import { createHmac, randomBytes } from 'node:crypto';
import type { Config, Env } from '../config.ts';
import { readSecret, writeSecret } from '../secrets.ts';

/**
 * What signs dashboard sessions: `SIFT_SESSION_SECRET`, for a host that keeps no files between starts;
 * otherwise made the first time it is needed and kept in the home directory.
 */
export function sessionSecret(config: Config, env: Env = process.env): string {
  if (env['SIFT_SESSION_SECRET']) return env['SIFT_SESSION_SECRET'];
  const stored = readSecret(config.dashboardKeyPath, config.keys);
  if (stored !== null) return stored.trim();
  const key = randomBytes(32).toString('base64url');
  writeSecret(config.dashboardKeyPath, key, config.keys);
  return key;
}

/** What `sift run` calls the dashboard's `/api/cron` with each minute: made from the session secret, so nothing more is kept. */
export const cronSecret = (sessionSecret: string) => createHmac('sha256', sessionSecret).update('sift cron').digest('base64url');
