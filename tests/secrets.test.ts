import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadEnvFiles, secretPaths } from '../src/config.ts';
import { clientFor, installClient, loadClientSecrets, saveRefreshToken } from '../src/gmail/auth.ts';
import { fileCredentialStore } from '../src/model/credentials.ts';
import { loadKeyring, readSecret, rekeySecrets, writeSecret } from '../src/secrets.ts';

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

  it('re-encrypts a value under an old key when it is next written', async () => {
    const path = join(dir(), 'model-auth.json');
    await fileCredentialStore(path, A).modify('openai', async () => ({ type: 'api_key', key: 'k1' }));
    await fileCredentialStore(path, B_AFTER_A).modify('other', async () => ({ type: 'api_key', key: 'k2' }));
    expect(await fileCredentialStore(path, B).read('openai')).toEqual({ type: 'api_key', key: 'k1' });
  });

  it('encrypts plain values once a key is set', () => {
    const path = join(dir(), 'model-auth.json');
    writeFileSync(path, '{"openai":{}}');
    expect(readSecret(path, A)).toBe('{"openai":{}}');
    expect(rekeySecrets([path], A)).toEqual({ encrypted: [path], rotated: [] });
    expect(readFileSync(path, 'utf8').startsWith('sift-secret:v1:')).toBe(true);
    expect(readSecret(path, A)).toBe('{"openai":{}}');
  });

  it('fails on a wrong or missing key, naming every file and what to do, and rewrites nothing', () => {
    const home = dir();
    const [locked, plain] = [join(home, 'token.json'), join(home, 'dashboard-key')];
    writeSecret(locked, 'one', A);
    writeFileSync(plain, 'two');

    for (const keys of [B, NONE]) {
      expect(() => readSecret(locked, keys)).toThrow(locked);
      expect(() => rekeySecrets([plain, locked], keys)).toThrow(
        /token\.json was encrypted with a key that is not in SIFT_KEY.*delete that file and sign in to Google and the model provider again/,
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

describe('credentials on disk', () => {
  it('encrypts the Google client, refresh tokens and model credentials, and reads them back', async () => {
    const config = loadConfig({ SIFT_HOME: dir(), SIFT_KEY: 'key-a' });
    installClient(config, JSON.stringify({ web: { client_id: 'id', client_secret: 'client-secret-value' } }));
    saveRefreshToken(config, 'me@example.com', 'refresh-token-value');
    await fileCredentialStore(config.modelAuthPath, config.keys).modify('openai', async () => ({ type: 'api_key', key: 'api-key-value' }));

    const paths = secretPaths(config).filter((p) => p !== config.dashboardKeyPath);
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(readFileSync(path, 'utf8')).toMatch(/^sift-secret:v1:[0-9a-f]{8}:[\w-]+:[\w-]+\n$/);

    const secrets = loadClientSecrets(config, {});
    expect(secrets.clientSecret).toBe('client-secret-value');
    expect(clientFor(config, secrets, 'me@example.com').credentials.refresh_token).toBe('refresh-token-value');
    expect(await fileCredentialStore(config.modelAuthPath, config.keys).read('openai')).toEqual({ type: 'api_key', key: 'api-key-value' });

    const wrong = loadConfig({ SIFT_HOME: config.home, SIFT_KEY: 'key-b' });
    expect(() => clientFor(wrong, secrets, 'me@example.com')).toThrow('SIFT_KEY');
    await expect(fileCredentialStore(wrong.modelAuthPath, wrong.keys).read('openai')).rejects.toThrow('SIFT_KEY');
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
});
