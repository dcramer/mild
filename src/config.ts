import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Config {
  /** Holds the database and OAuth tokens. A volume in Docker. */
  dataDir: string;
  dbPath: string;
  /** The user's broad guidance for triage, in plain language. Optional. */
  guidelinesPath: string;
  /** Model provider credentials (API keys, OAuth tokens). */
  modelAuthPath: string;
  /** `provider/model-id` for the inference tier, from SIFT_MODEL. Undefined turns the tier off. */
  model: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolve(env['SIFT_DATA_DIR'] ?? 'data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    dataDir,
    dbPath: join(dataDir, 'sift.db'),
    guidelinesPath: join(dataDir, 'guidelines.md'),
    modelAuthPath: join(dataDir, 'model-auth.json'),
    model: env['SIFT_MODEL'] || undefined,
  };
}
