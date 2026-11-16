import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadEnvFiles, saveKeyFile, secretPaths } from '../src/config.ts';
import { installClient, loadClientSecrets } from '../src/gmail/auth.ts';
import { credentialStore } from '../src/model/credentials.ts';
import { loadKeyring, readSecret, rekeySecrets, writeSecret } from '../src/secrets.ts';
import { connectAccount } from '../src/store/accounts.ts';
import { credentials, rekeyCredentials } from '../src/store/credentials.ts';
import { freshStore, raw } from './fixtures.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'sift-secrets-'));
const NONE = loadKeyring({});
const A = loadKeyring({ SIFT_KEY: 'key-a' });
const B_AFTER_A = loadKeyring({ SIFT_KEY: 'key-b', SIFT_OLD_KEYS: 'key-a, key-b' });
const B = loadKeyring({ SIFT_KEY: 'key-b' });

describe('secrets', () => {
  it('stores plain text when there is no key', () => {
    const path = join(dir(), 'token.json');
    writeSecret(path, '{"a":1}', NONE);
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}');
    expect(readSecret(path, NONE)).toBe('{"a":1}');
    expect(readSecret(join(dir(), 'missing'), NONE)).toBeNull();
    expect(rekeySecrets([path], NONE)).toEqual({ encrypted: [], rotated: [] });
  });

  it('round-trips through an encrypted, owner-only file that names its key', () => {
    const path = join(dir(), 'token.json');
    writeSecret(path, 'refresh-token-value', A);
    const stored = readFileSync(path, 'utf8');
    expect(stored).not.toContain('refresh-token-value');
    expect(stored.startsWith(`sift-secret:v1:${A.current!.id}:`)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readSecret(path, A)).toBe('refresh-token-value');

    writeSecret(path, 'refresh-token-value', A);
    expect(readFileSync(path, 'utf8')).not.toBe(stored);
  });

  it('gives the same secret the same key id and a different secret another', () => {
    expect(loadKeyring({ SIFT_KEY: ' key-a ' }).current!.id).toBe(A.current!.id);
    expect(B.current!.id).not.toBe(A.current!.id);
    expect(B_AFTER_A.old.map((k) => k.id)).toEqual([A.current!.id]);
  });

  it('reads with an old key and re-encrypts with the current one', () => {
    const home = dir();
    const [token, key] = [join(home, 'token.json'), join(home, 'dashboard-key')];
    writeSecret(token, 'one', A);
    writeSecret(key, 'two', B);

    expect(readSecret(token, B_AFTER_A)).toBe('one');
    expect(rekeySecrets([token, key, join(home, 'missing')], B_AFTER_A, false)).toEqual({ encrypted: [], rotated: [token] });
    expect(() => readSecret(token, B)).toThrow('SIFT_OLD_KEYS');

    expect(rekeySecrets([token, key], B_AFTER_A)).toEqual({ encrypted: [], rotated: [token] });
    expect(readSecret(token, B)).toBe('one');
    expect(rekeySecrets([token, key], B)).toEqual({ encrypted: [], rotated: [] });
  });

  it('encrypts plain values once a key is set', () => {
    const path = join(dir(), 'google-client.json');
    writeFileSync(path, '{"web":{}}');
    expect(readSecret(path, A)).toBe('{"web":{}}');
    expect(rekeySecrets([path], A)).toEqual({ encrypted: [path], rotated: [] });
    expect(readFileSync(path, 'utf8').startsWith('sift-secret:v1:')).toBe(true);
    expect(readSecret(path, A)).toBe('{"web":{}}');
  });

  it('fails on a wrong or missing key, naming every file and what to do, and rewrites nothing', () => {
    const home = dir();
    const [locked, plain] = [join(home, 'token.json'), join(home, 'dashboard-key')];
    writeSecret(locked, 'one', A);
    writeFileSync(plain, 'two');

    for (const keys of [B, NONE]) {
      expect(() => readSecret(locked, keys)).toThrow(locked);
      expect(() => rekeySecrets([plain, locked], keys)).toThrow(
        /token\.json was encrypted with a key that is not in SIFT_KEY.*sign in to Google and the model provider again/,
      );
    }
    expect(readFileSync(plain, 'utf8')).toBe('two');
  });

  it('refuses a value that was altered or moved to another file', () => {
    const home = dir();
    const [mine, theirs] = [join(home, 'a%40example.com.json'), join(home, 'b%40example.com.json')];
    writeSecret(mine, 'one', A);
    writeFileSync(theirs, readFileSync(mine));
    expect(() => readSecret(theirs, A)).toThrow(theirs);

    const stored = readFileSync(mine, 'utf8').trim();
    writeFileSync(mine, `${stored.slice(0, -2)}${stored.endsWith('AA') ? 'BB' : 'AA'}`);
    expect(() => readSecret(mine, A)).toThrow(mine);
  });
});

describe('credentials', () => {
  /** A store with two people, Alpha (1) and Beta (2), and the raw value of each stored credential. */
  async function people() {
    const store = await freshStore();
    await connectAccount(store, 'alpha@example.org', '1', 0);
    await connectAccount(store, 'beta@example.net', '1', 0);
    const stored = async (id: number) =>
      await raw(await store.user(id)).all<{ kind: string; key: string; value: string }>('SELECT kind, key, value FROM credentials');
    return { store, stored };
  }

  it("keeps the Google client in a file, and sign-ins in their person's database, encrypted", async () => {
    const config = loadConfig({ SIFT_HOME: dir(), SIFT_KEY: 'key-a' });
    installClient(config, JSON.stringify({ web: { client_id: 'id', client_secret: 'client-secret-value' } }));
    expect(secretPaths(config).filter((p) => p !== config.dashboardKeyPath)).toEqual([config.googleClientPath]);
    expect(readFileSync(config.googleClientPath, 'utf8')).toMatch(/^sift-secret:v1:[0-9a-f]{8}:[\w-]+:[\w-]+\n$/);
    expect(loadClientSecrets(config, {}).clientSecret).toBe('client-secret-value');

    const { store, stored } = await people();
    const alpha = await store.user(1);
    await (await credentials(alpha, 'gmail', A)).write('alpha@example.org', 'refresh-token-value');
    await credentialStore(await credentials(alpha, 'model', A)).modify('openai', async () => ({ type: 'api_key', key: 'api-key-value' }));
    for (const row of await stored(1)) expect(row.value).toMatch(/^sift-secret:v1:/);
    expect(await (await credentials(alpha, 'gmail', A)).read('alpha@example.org')).toBe('refresh-token-value');
    expect(await credentialStore(await credentials(alpha, 'model', A)).read('openai')).toEqual({ type: 'api_key', key: 'api-key-value' });
    await expect((await credentials(alpha, 'gmail', B)).read('alpha@example.org')).rejects.toThrow('SIFT_KEY');
  });

  it("does not open one copied into another row or another person's database", async () => {
    const { store, stored } = await people();
    const [alpha, beta] = [await store.user(1), await store.user(2)];
    await (await credentials(alpha, 'gmail', A)).write('alpha@example.org', 'alpha-token');
    const [stolen] = await stored(1);
    await raw(beta).run('INSERT INTO credentials (kind, key, value, updated_at) VALUES (?, ?, ?, 0)', 'gmail', 'alpha@example.org', stolen!.value);
    await expect((await credentials(beta, 'gmail', A)).read('alpha@example.org')).rejects.toThrow('person 2 gmail alpha@example.org');
    await raw(alpha).run(`INSERT INTO credentials (kind, key, value, updated_at) VALUES ('model', 'openai', ?, 0)`, stolen!.value);
    await expect((await credentials(alpha, 'model', A)).read('openai')).rejects.toThrow('person 1 model openai');
  });

  it('brings plain and old-key values under the current key, and refuses ones no key opens', async () => {
    const { store } = await people();
    const alpha = await store.user(1);
    await (await credentials(alpha, 'gmail', NONE)).write('alpha@example.org', 'plain-token');
    await (await credentials(alpha, 'model', A)).write('openai', '{"type":"api_key","key":"k"}');
    expect(await rekeyCredentials(alpha, B_AFTER_A, false)).toHaveLength(2);
    expect(await rekeyCredentials(alpha, B_AFTER_A)).toEqual(['Gmail access for alpha@example.org', 'Model sign-in for openai']);
    expect(await (await credentials(alpha, 'gmail', B)).read('alpha@example.org')).toBe('plain-token');
    expect(await rekeyCredentials(alpha, B)).toEqual([]);
    await expect(rekeyCredentials(alpha, A)).rejects.toThrow('SIFT_KEY');
  });
});

describe('.env', () => {
  it('reads the home then the working directory, never replacing what is set', () => {
    const names = ['SIFT_TEST_SET', 'SIFT_TEST_HOME', 'SIFT_TEST_BOTH', 'SIFT_TEST_CWD'];
    const [home, cwd] = [dir(), dir()];
    writeFileSync(join(home, '.env'), 'SIFT_TEST_SET=home\nSIFT_TEST_HOME=home\nSIFT_TEST_BOTH=home\n');
    writeFileSync(join(cwd, '.env'), 'SIFT_TEST_BOTH=cwd\nSIFT_TEST_CWD=cwd\n');
    process.env['SIFT_TEST_SET'] = 'environment';
    try {
      loadEnvFiles(home, cwd);
      loadEnvFiles(dir(), dir());
      expect(names.map((name) => process.env[name])).toEqual(['environment', 'home', 'home', 'cwd']);
    } finally {
      for (const name of names) delete process.env[name];
    }
  });

  it('adds the key to an existing .env without losing what it held, owner-only', () => {
    const cwd = dir();
    writeFileSync(join(cwd, '.env'), 'OTHER=1', { mode: 0o644 });
    const path = saveKeyFile(cwd, 'key-a');
    expect(parseEnv(readFileSync(path, 'utf8'))).toEqual({ OTHER: '1', SIFT_KEY: 'key-a' });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
