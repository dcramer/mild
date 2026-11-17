import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadEnvFiles, saveKeyFile, secretPaths } from '../src/config.ts';
import { installClient, loadClientSecrets } from '../src/gmail/auth.ts';
import { credentialStore } from '../src/model/credentials.ts';
import { type Keyring, loadKeyring, openSecret, openToRekey, readSecret, rekeySecrets, writeSecret } from '../src/secrets.ts';
import { credentials, rekeyCredentials } from '../src/store/credentials.ts';
import { conditionsHash, openJson, openPart, proposalName, rekeyContent, ruleDraftName, ruleName, sealJson, sealPart } from '../src/store/content.ts';
import { getRuleFilter, setRuleFilter } from '../src/store/filters.ts';
import { finishLabelProposal, latestLabelProposal, startLabelProposal } from '../src/store/labels.ts';
import { listProposals } from '../src/store/proposals.ts';
import { rekeyStore } from '../src/store/rekey.ts';
import { connectAccount, recordSync } from '../src/store/accounts.ts';
import { suggestionBodies } from '../src/store/query.ts';
import type { Sql } from '../src/store/sql.ts';
import { messageDetail } from '../src/dashboard/queries/messages.ts';
import { cachedCorrespondent, domainFacts, rememberCorrespondent, senderFacts } from '../src/store/senders.ts';
import { storedFacts } from '../src/store/messages.ts';
import { listDecisions } from '../src/dashboard/queries/decisions.ts';
import { recordDecision } from '../src/store/decisions.ts';
import { hasRuleFor, listRules, setRule, startRuleDraft } from '../src/store/rules.ts';
import { getAction, insertPendingAction } from '../src/store/actions.ts';
import { everything, facts, storeExample, withSampleLabels } from './helpers.ts';
import { shotCandidates } from '../src/store/examples.ts';
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
    /** A person's database as Sift opens it with these keys. */
    const as = async (id: number, keys: Keyring) => await (await freshStore(keys)).user(id);
    return { store, stored, as };
  }

  it("keeps the Google client in a file, and sign-ins in their person's database, encrypted", async () => {
    const config = loadConfig({ SIFT_HOME: dir(), SIFT_KEY: 'key-a' });
    installClient(config, JSON.stringify({ web: { client_id: 'id', client_secret: 'client-secret-value' } }));
    expect(secretPaths(config).filter((p) => p !== config.dashboardKeyPath)).toEqual([config.googleClientPath]);
    expect(readFileSync(config.googleClientPath, 'utf8')).toMatch(/^sift-secret:v1:[0-9a-f]{8}:[\w-]+:[\w-]+\n$/);
    expect(loadClientSecrets(config, {}).clientSecret).toBe('client-secret-value');

    const { stored, as } = await people();
    const alpha = await as(1, A);
    await (await credentials(alpha, 'gmail')).write('alpha@example.org', 'refresh-token-value');
    await credentialStore({ ...(await credentials(alpha, 'model')), exclusive: (work) => work() }).modify('openai', async () => ({
      type: 'api_key',
      key: 'api-key-value',
    }));
    for (const row of await stored(1)) expect(row.value).toMatch(/^sift-secret:v1:/);
    expect(await (await credentials(alpha, 'gmail')).read('alpha@example.org')).toBe('refresh-token-value');
    expect(await credentialStore({ ...(await credentials(alpha, 'model')), exclusive: (work) => work() }).read('openai')).toEqual({
      type: 'api_key',
      key: 'api-key-value',
    });
    await expect((await credentials(await as(1, B), 'gmail')).read('alpha@example.org')).rejects.toThrow('SIFT_KEY');
  });

  it("does not open one copied into another row or another person's database", async () => {
    const { stored, as } = await people();
    const [alpha, beta] = [await as(1, A), await as(2, A)];
    await (await credentials(alpha, 'gmail')).write('alpha@example.org', 'alpha-token');
    const [stolen] = await stored(1);
    await raw(beta).run('INSERT INTO credentials (kind, key, value) VALUES (?, ?, ?)', 'gmail', 'alpha@example.org', stolen!.value);
    await expect((await credentials(beta, 'gmail')).read('alpha@example.org')).rejects.toThrow('person 2 gmail alpha@example.org');
    await raw(alpha).run(`INSERT INTO credentials (kind, key, value) VALUES ('model', 'openai', ?)`, stolen!.value);
    await expect((await credentials(alpha, 'model')).read('openai')).rejects.toThrow('person 1 model openai');
  });

  it('refuses a plain value once there is a key, so none can be put in place of a sealed one', async () => {
    const { as } = await people();
    const alpha = await as(1, A);
    await raw(alpha).run(`INSERT INTO credentials (kind, key, value) VALUES ('model', 'openai', ?)`, '{"type":"api_key","key":"planted"}');
    await expect((await credentials(alpha, 'model')).read('openai')).rejects.toThrow('person 1 model openai is stored unencrypted');
    expect(await (await credentials(await as(1, NONE), 'model')).read('openai')).toBe('{"type":"api_key","key":"planted"}');
    expect(openToRekey('x', 'plain', A)).toBe('plain');
    expect(() => openSecret('x', 'plain', A)).toThrow('SIFT_KEY is set');
  });

  it('brings plain and old-key values under the current key, and refuses ones no key opens', async () => {
    const { as } = await people();
    await (await credentials(await as(1, NONE), 'gmail')).write('alpha@example.org', 'plain-token');
    await (await credentials(await as(1, A), 'model')).write('openai', '{"type":"api_key","key":"k"}');
    const rotating = await as(1, B_AFTER_A);
    expect(await rekeyCredentials(rotating, false)).toHaveLength(2);
    expect(await rekeyCredentials(rotating)).toEqual(['Gmail access for alpha@example.org', 'Model sign-in for openai']);
    expect(await (await credentials(await as(1, B), 'gmail')).read('alpha@example.org')).toBe('plain-token');
    expect(await rekeyCredentials(await as(1, B))).toEqual([]);
    await expect(rekeyCredentials(await as(1, A))).rejects.toThrow('SIFT_KEY');
  });
});

describe('mail', () => {
  /** Two messages recorded with `keys`. */
  async function alpha(keys = NONE) {
    const store = await freshStore();
    await connectAccount(store, 'alpha@example.org', '1', 0);
    const as = async (keys: Keyring) => await (await freshStore(keys)).user(1);
    const plain = await as(NONE);
    await recordSync(
      await as(keys),
      'alpha@example.org',
      ['m1', 'm2'].map((messageId) =>
        facts({ accountId: 'alpha@example.org', messageId, from: { address: 'news@example.com', domain: 'example.com', name: 'Example News' } }),
      ),
      '2',
      0,
    );
    const hold = async (db: Sql, messageId: string, text: string, html: string | null) =>
      await db.insert(suggestionBodies).values({
        accountId: 'alpha@example.org',
        messageId,
        bodyText: sealPart(db, 'alpha@example.org', messageId, 'text', text)!,
        bodyHtml: sealPart(db, 'alpha@example.org', messageId, 'html', html),
        fetchedAt: 0,
      });
    const stored = async () =>
      await raw(plain).all<{ message_id: string; body_text: string; body_html: string | null }>(
        'SELECT message_id, body_text, body_html FROM suggestion_bodies ORDER BY message_id',
      );
    return { as, hold, stored };
  }

  it('keeps a message’s headers encrypted for that message, and reads its sender, recipients and subject from them', async () => {
    const { as } = await alpha(A);
    const db = await as(A);
    const [m1] = await raw(db).all<{ headers: string }>('SELECT headers FROM messages ORDER BY id');
    expect(m1!.headers).toMatch(/^sift-secret:v1:/);
    expect(await messageDetail(db, await everything(db), 'alpha@example.org', 'm1')).toMatchObject({
      fromAddress: 'news@example.com',
      fromName: 'Example News',
      subject: 'Weekly digest',
      to: [{ address: 'me@example.org' }],
      headers: { subject: 'Weekly digest' },
    });
    await expect(messageDetail(await as(B), await everything(db), 'alpha@example.org', 'm1')).rejects.toThrow('SIFT_KEY');
  });

  it('finds a sender by a hash of their address that differs for each person, and shows it decrypted', async () => {
    const { as } = await alpha(A);
    const store = await freshStore(A);
    await connectAccount(store, 'bravo@example.org', '1', 0);
    const bravo = await store.user(2);
    await recordSync(bravo, 'bravo@example.org', [facts({ accountId: 'bravo@example.org', messageId: 'b1' })], '2', 0);
    const db = await as(A);
    const SELECT = 'SELECT sender_hash, domain_hash FROM messages ORDER BY id';
    const [m1, m2] = await raw(db).all<{ sender_hash: string }>(SELECT);
    const [b1] = await raw(bravo).all<{ sender_hash: string }>(SELECT);
    expect(JSON.stringify([m1, m2, b1])).not.toContain('example.com');
    expect(m1!.sender_hash).toBe(m2!.sender_hash);
    expect(b1!.sender_hash).not.toBe(m1!.sender_hash);
    expect(await senderFacts(db, 'alpha@example.org', 'NEWS@example.com')).toMatchObject({ messages: 2 });
    expect(await domainFacts(db, 'alpha@example.org', 'example.com')).toMatchObject({ messages: 2, senders: 1 });
    expect(await messageDetail(db, await everything(db), 'alpha@example.org', 'm1')).toMatchObject({ fromAddress: 'news@example.com' });
  });

  it('keeps only that there is a list id, and gives it back from the headers, to examples too', async () => {
    const { as } = await alpha(A);
    const db = await as(A);
    await withSampleLabels(db, 'alpha@example.org');
    await recordSync(
      db,
      'alpha@example.org',
      [facts({ accountId: 'alpha@example.org', messageId: 'm3', headers: { 'list-id': '<news.example.com>' } })],
      '3',
      0,
    );
    const row = await raw(db).get<{ facts: { listId: string } }>("SELECT facts FROM messages WHERE id = 'm3'");
    expect(row!.facts.listId).not.toContain('example.com');
    expect(await storedFacts(db, 'alpha@example.org', 'm3')).toMatchObject({ listId: 'news.example.com' });
    await storeExample(db, 'alpha@example.org', { id: 'm4', from: 'list@example.net', label: 'newsletter', headers: { 'list-id': '<news.example.com>' } });
    const [shot] = await shotCandidates(db, facts({ accountId: 'alpha@example.org', from: { address: 'list@example.net', domain: 'example.net' } }));
    expect(shot).toMatchObject({ messageId: 'm4', facts: { listId: 'news.example.com' } });
  });

  it('brings mail recorded before there was a key under it, for every person in the store', async () => {
    const { as } = await alpha();
    await expect(messageDetail(await as(A), await everything(await as(A)), 'alpha@example.org', 'm1')).rejects.toThrow('stored unencrypted');
    expect(await rekeyStore(await freshStore(A), true)).toEqual({ credentials: [], messages: 2 });
    const db = await as(A);
    expect(JSON.stringify(await raw(db).all('SELECT headers, sender_hash FROM messages'))).not.toContain('example.com');
    expect(await messageDetail(db, await everything(db), 'alpha@example.org', 'm1')).toMatchObject({ fromAddress: 'news@example.com' });
    expect(await senderFacts(db, 'alpha@example.org', 'news@example.com')).toMatchObject({ messages: 2 });
  });

  it('keeps who the owner has written to only as hashes, and forgets it under a new key', async () => {
    const { as } = await alpha(A);
    await rememberCorrespondent(await as(A), 'alpha@example.org', 'friend@example.net', true, 0);
    const db = await as(A);
    expect(JSON.stringify(await raw(db).all('SELECT * FROM correspondents'))).not.toContain('example.net');
    expect(await cachedCorrespondent(db, 'alpha@example.org', 'friend@example.net', 0)).toBe(true);
    expect(await rekeyContent(await as(A))).toBe(0);
    expect(await cachedCorrespondent(db, 'alpha@example.org', 'friend@example.net', 0)).toBe(true);
    expect(await rekeyContent(await as(B_AFTER_A))).toBe(2);
    expect(await cachedCorrespondent(await as(B), 'alpha@example.org', 'friend@example.net', 0)).toBeUndefined();
    expect(await senderFacts(await as(B), 'alpha@example.org', 'news@example.com')).toMatchObject({ messages: 2 });
  });

  it('keeps rules, changes and reasons encrypted, and finds a rule by its hashed conditions under each key', async () => {
    const { as } = await alpha(A);
    const db = await as(A);
    const id = await setRule(db, 'alpha@example.org', { from: ['news@example.com'] }, { disposition: 'archive', name: 'Example news' }, 'user', 0);
    expect(await setRule(db, 'alpha@example.org', { from: ['news@example.com'] }, { disposition: 'keep' }, 'user', 0)).toBe(id);
    await recordDecision(
      db,
      'alpha@example.org',
      'm1',
      { disposition: 'archive', subscription: 'preserve', stage: 'rules', reason: 'rule: from news@example.com' },
      { now: 0 },
    );
    const action = await insertPendingAction(
      db,
      {
        accountId: 'alpha@example.org',
        messageId: 'm1',
        type: 'unsubscribe',
        payload: { add: [], remove: [], unsubscribe: 'news.example.com' },
        originalLabels: [],
      },
      0,
    );
    await setRuleFilter(db, id, { filterId: 'f1', state: 'active', written: { from: 'news@example.com' } }, 0);
    const suggested = await startLabelProposal(db, { accountId: 'alpha@example.org', goal: 'Example news out of the way', model: 'test/model', now: 0 });
    const draft = { name: 'Example news', description: 'From news@example.com', disposition: 'archive', why: 'Example news' } as const;
    await finishLabelProposal(db, 'alpha@example.org', suggested, { drafts: [draft], now: 0 });
    await startRuleDraft(db, { accountId: 'alpha@example.org', goal: 'Archive news@example.com', model: 'test/model', now: 0 });
    const stored = await raw(db).all(
      'SELECT r.match, r.except_matches, r.conditions, r.name, r.filter_written, d.reason, a.payload, l.goal, l.labels, rd.goal FROM rules r, decisions d, actions a, label_proposals l, rule_drafts rd',
    );
    expect(JSON.stringify(stored)).not.toContain('example.com');
    expect(JSON.stringify(stored)).not.toContain('Example news');
    // A rule replaced without a name keeps its own.
    expect((await listRules(db, 'alpha@example.org'))[0]).toMatchObject({
      id,
      match: { from: ['news@example.com'] },
      disposition: 'keep',
      name: 'Example news',
    });
    expect((await listDecisions(db, await everything(db), { days: 36_500 }, 0)).rows[0]).toMatchObject({ reason: 'rule: from news@example.com' });

    await rekeyContent(await as(B_AFTER_A));
    const b = await as(B);
    expect(await hasRuleFor(b, 'alpha@example.org', { from: ['news@example.com'] })).toBe(true);
    expect((await listRules(b, 'alpha@example.org'))[0]).toMatchObject({ name: 'Example news' });
    expect(await getAction(b, action)).toMatchObject({ payload: { unsubscribe: 'news.example.com' } });
    expect(await getRuleFilter(b, id)).toMatchObject({ written: { from: 'news@example.com' } });
    expect(await latestLabelProposal(b, ['alpha@example.org'])).toMatchObject({ goal: 'Example news out of the way', drafts: [draft] });
    const [{ goal }] = (await raw(b).all('SELECT goal FROM rule_drafts')) as [{ goal: string }];
    expect(openJson(b, ruleDraftName(b, 'alpha@example.org', 'goal'), goal)).toBe('Archive news@example.com');
  });

  it('hashes at start the conditions a migration could not, with or without a key', async () => {
    const { as } = await alpha();
    const db = await as(NONE);
    await raw(db).run(
      `INSERT INTO rules (id, account_id, position, match, except_matches, conditions, disposition, source, created_at) VALUES ('r', 'alpha@example.org', 0, '{"from": ["a@example.com"]}', '[]', 'unset:x', 'archive', 'user', 0)`,
    );
    expect(await hasRuleFor(db, 'alpha@example.org', { from: ['a@example.com'] })).toBe(false);
    await rekeyContent(db);
    expect(await hasRuleFor(db, 'alpha@example.org', { from: ['a@example.com'] })).toBe(true);
  });

  it('reads a rule or proposal stored with one value per condition as a list of it', async () => {
    const { as } = await alpha(A);
    const db = await as(A);
    await withSampleLabels(db, 'alpha@example.org');
    const old = { from: 'a@example.com', subjectContains: 'Weekly' };
    await raw(db).run(
      `INSERT INTO rules (id, account_id, position, match, except_matches, conditions, disposition, source, created_at) VALUES ('r', 'alpha@example.org', 0, ?, ?, 'unset:r', 'archive', 'user', 0)`,
      sealJson(db, ruleName(db, 'r', 'match'), old),
      sealJson(db, ruleName(db, 'r', 'except'), [{ fromName: 'Example' }]),
    );
    await raw(db).run(
      `INSERT INTO proposals (account_id, match, conditions, label_id, disposition, agreed, created_at) VALUES ('alpha@example.org', ?, 'unset:p', 'newsletter', 'archive', 3, 0)`,
      sealJson(db, proposalName(db, 'alpha@example.org'), { from: 'b@example.com' }),
    );
    await rekeyContent(db);
    expect((await listRules(db, 'alpha@example.org'))[0]).toMatchObject({
      match: { from: ['a@example.com'], subjectContains: ['Weekly'] },
      except: [{ fromName: ['Example'] }],
    });
    expect(await raw(db).get('SELECT conditions FROM rules')).toEqual({
      conditions: conditionsHash(db, { from: ['a@example.com'], subjectContains: ['Weekly'] }, [{ fromName: ['Example'] }]),
    });
    expect((await listProposals(db, 'alpha@example.org'))[0]).toMatchObject({ match: { from: ['b@example.com'] } });
  });

  it('keeps the answered one of two proposals for the same mail that hashed apart before conditions held lists', async () => {
    const { as } = await alpha(A);
    const db = await as(A);
    await withSampleLabels(db, 'alpha@example.org');
    await raw(db).run(
      `INSERT INTO proposals (account_id, match, conditions, label_id, disposition, agreed, status, created_at) VALUES ('alpha@example.org', ?, 'unset:p', 'newsletter', 'archive', 3, 'dismissed', 0)`,
      sealJson(db, proposalName(db, 'alpha@example.org'), { from: 'b@example.com' }),
    );
    await raw(db).run(
      `INSERT INTO proposals (account_id, match, conditions, label_id, disposition, agreed, created_at) VALUES ('alpha@example.org', ?, ?, 'newsletter', 'archive', 3, 1)`,
      sealJson(db, proposalName(db, 'alpha@example.org'), { from: ['b@example.com'] }),
      conditionsHash(db, { from: ['b@example.com'] }),
    );
    await rekeyContent(db);
    expect(await raw(db).all('SELECT status FROM proposals')).toEqual([{ status: 'dismissed' }]);
  });

  it('finds mail by its subject, which the database cannot read', async () => {
    const { as } = await alpha(A);
    const db = await as(A);
    for (const messageId of ['m1', 'm2'])
      await recordDecision(db, 'alpha@example.org', messageId, { disposition: 'keep', subscription: 'preserve', stage: 'rules', reason: 'test' }, { now: 0 });
    expect(await listDecisions(db, await everything(db), { days: 36_500, search: 'DIGEST', limit: 1, offset: 1 }, 0)).toMatchObject({
      total: 2,
      rows: [{ messageId: 'm1', subject: 'Weekly digest' }],
    });
    expect((await listDecisions(db, await everything(db), { days: 36_500, search: 'nothing like it' }, 0)).total).toBe(0);
  });

  it('takes a subject that only looks encrypted for what it says, without a key', async () => {
    const { as } = await alpha();
    const db = await as(NONE);
    const forged = `sift-secret:v1:${A.current!.id}:AAAAAAAAAAAAAAAA:AAAA`;
    await recordSync(db, 'alpha@example.org', [facts({ accountId: 'alpha@example.org', messageId: 'm3', subject: forged })], '3', 0);
    expect(await messageDetail(db, await everything(db), 'alpha@example.org', 'm3')).toMatchObject({ subject: forged });
    expect(await rekeyContent(await as(A))).toBe(3);
    expect(await messageDetail(await as(A), await everything(db), 'alpha@example.org', 'm3')).toMatchObject({ subject: forged });
  });

  it('keeps the text and HTML encrypted, with no HTML as null, and opens them only for their own message', async () => {
    const { as, hold, stored } = await alpha(A);
    const db = await as(A);
    await hold(db, 'm1', 'Hello', '<p>Hello</p>');
    await hold(db, 'm2', 'Plain', null);
    const [m1, m2] = await stored();
    expect(m1).toMatchObject({ body_text: expect.stringMatching(/^sift-secret:v1:/), body_html: expect.stringMatching(/^sift-secret:v1:/) });
    expect(JSON.stringify(m1)).not.toContain('Hello');
    expect(m2!.body_html).toBeNull();
    expect(await messageDetail(db, await everything(db), 'alpha@example.org', 'm1')).toMatchObject({ body: 'Hello', hasHtml: true });
    expect(await messageDetail(db, await everything(db), 'alpha@example.org', 'm2')).toMatchObject({ body: 'Plain', hasHtml: false });
    expect(() => openPart(db, 'alpha@example.org', 'm2', 'text', m1!.body_text)).toThrow('SIFT_KEY');
    await expect(messageDetail(await as(B), await everything(db), 'alpha@example.org', 'm1')).rejects.toThrow('SIFT_KEY');
  });

  it('brings bodies stored plain or under an old key under the current one', async () => {
    const { as, hold, stored } = await alpha();
    await hold(await as(NONE), 'm1', 'Hello', '<p>Hello</p>');
    await hold(await as(A), 'm2', 'Plain', null);
    await expect(messageDetail(await as(A), await everything(await as(A)), 'alpha@example.org', 'm1')).rejects.toThrow('stored unencrypted');
    expect(await rekeyContent(await as(B_AFTER_A), false)).toBe(2);
    expect(await rekeyContent(await as(B_AFTER_A))).toBe(2);
    expect(await rekeyContent(await as(B))).toBe(0);
    for (const row of await stored()) expect(row.body_text).toMatch(/^sift-secret:v1:/);
    for (const row of await raw(await as(B)).all<{ headers: string }>('SELECT headers FROM messages')) expect(row.headers).toMatch(/^sift-secret:v1:/);
    expect(await messageDetail(await as(B), await everything(await as(B)), 'alpha@example.org', 'm1')).toMatchObject({ body: 'Hello', hasHtml: true });
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
