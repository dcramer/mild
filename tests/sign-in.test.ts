import type { Sql } from '../src/store/sql.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SignIn } from '../src/dashboard/controls.ts';
import { people } from '../src/store/people.ts';
import { connectAccount } from '../src/store/accounts.ts';
import { preferences } from '../src/store/preferences.ts';
import { ACCOUNT } from './helpers.ts';
import { type Reply, raw, startDashboard, onePerson } from './fixtures.ts';
import type { Store } from '../src/store/store.ts';

let db: Sql;
let store: Store;

beforeEach(async () => {
  ({ store, db } = await onePerson(ACCOUNT));
});

describe('signing in with Google', () => {
  const SECRET = 'session-secret';
  let completed: string[];
  let logged: string[];
  let hasClient: boolean;
  const signIn: SignIn = {
    hasClient: () => hasClient,
    url: (redirectUri, state, challenge, send) =>
      `https://accounts.example/auth?redirect=${encodeURIComponent(redirectUri)}&state=${state}&challenge=${challenge}${send ? `&send=${send}` : ''}`,
    complete: async (redirectUri, code, _verifier, addTo, send) => {
      completed.push(`${redirectUri} ${code} addTo=${addTo}${send ? ` send=${send}` : ''}`);
      if (code === 'refused') throw new Error('invalid_grant');
      if (code === 'second') {
        await connectAccount(store, 'work@example.com', '1', 0, 1);
        return 'work@example.com';
      }
      // Already someone else's: connecting it again leaves it theirs.
      if (code === 'taken') {
        await connectAccount(store, 'bravo@example.net', '1', 0);
        return 'bravo@example.net';
      }
      return ACCOUNT;
    },
  };

  async function startWithSignIn() {
    return await startDashboard(people(store), {
      signIn,
      sessionSecret: SECRET,
      signInAddresses: ['http://localhost:1', 'https://box.example.ts.net'],
      allowedHosts: ['box.example.ts.net', 'homebox'],
      log: (line) => logged.push(line),
      now: () => 1000,
    });
  }
  const cookieFrom = (headers: Record<string, string | string[] | undefined>) => String(headers['set-cookie']).split(';')[0] ?? '';
  const stateFrom = (headers: Record<string, string | string[] | undefined>) => new URL(String(headers['location'])).searchParams.get('state') ?? '';
  /** Google's return to the browser that started `login`, which holds its sign-in cookie. */
  const callback = (call: Awaited<ReturnType<typeof startDashboard>>['call'], login: Reply, code: string, headers: Record<string, string> = {}) =>
    call('GET', `/auth/callback?state=${stateFrom(login.headers)}&code=${code}`, undefined, {
      ...headers,
      cookie: [headers['cookie'], cookieFrom(login.headers)].filter(Boolean).join('; '),
    });

  beforeEach(() => {
    completed = [];
    logged = [];
    hasClient = true;
  });

  it('serves the data only to someone signed in', async () => {
    const { call } = await startWithSignIn();
    for (const path of ['/api/summary', '/api/manage', '/api/suggestions', '/api/senders']) expect((await call('GET', path)).status).toBe(401);
    expect((await call('POST', '/api/active', { active: true })).status).toBe(401);
    expect((await call('GET', '/api/summary', undefined, { cookie: 'sift_session=forged.signature' })).status).toBe(401);
    expect((await call('GET', '/api/session')).body).toMatchObject({ required: true, email: null, canSignIn: true, reason: null });
    expect((await preferences(db)).active).toBe(false);
  });

  it("tells anyone whether this Mild is a service, which has terms, or someone's own copy", async () => {
    expect((await (await startWithSignIn()).call('GET', '/api/session')).body).toMatchObject({ cloud: false });
    const service = await startDashboard(people(store), { signIn, sessionSecret: SECRET, cloud: true });
    expect((await service.call('GET', '/api/session')).body).toMatchObject({ email: null, cloud: true });
  });

  it('signs in through Google and returns to the address the browser used', async () => {
    const { call, port } = await startWithSignIn();
    const login = await call('GET', '/auth/login');
    expect(login.status).toBe(303);
    expect(String(login.headers['location'])).toContain(encodeURIComponent(`http://localhost:${port}/auth/callback`));

    const back = await callback(call, login, 'abc');
    expect(back.status).toBe(303);
    expect(back.headers['location']).toBe('/');
    const [session, started] = back.headers['set-cookie'] as string[];
    expect(session).toMatch(/^sift_session=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    expect(started).toBe('sift_signin=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax');
    expect(completed).toEqual([`http://localhost:${port}/auth/callback abc addTo=null`]);

    const cookie = { cookie: cookieFrom(back.headers) };
    expect((await call('GET', '/api/session', undefined, cookie)).body).toMatchObject({ email: ACCOUNT });
    expect((await call('GET', '/api/manage', undefined, cookie)).status).toBe(200);
    expect((await call('POST', '/api/active', { active: true }, cookie)).status).toBe(200);

    // The same state cannot be used twice, and an unknown one is refused.
    expect(String((await callback(call, login, 'abc')).headers['location'])).toContain('expired');
    expect(completed).toHaveLength(1);
  });

  it('issues the session again once it is a day old, as the page asks who is signed in, so using Mild within the month never signs anyone out', async () => {
    let now = 1000;
    const { call } = await startDashboard(people(store), { signIn, sessionSecret: SECRET, now: () => now });
    const first = { cookie: cookieFrom((await callback(call, await call('GET', '/auth/login'), 'abc')).headers) };
    expect((await call('GET', '/api/session', undefined, first)).headers['set-cookie']).toBeUndefined();

    now += 29 * 86_400_000;
    const renewed = await call('GET', '/api/session', undefined, first);
    expect(renewed.body).toMatchObject({ email: ACCOUNT });
    expect(String(renewed.headers['set-cookie'])).toMatch(/^sift_session=[^;]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    const second = { cookie: cookieFrom(renewed.headers) };

    now += 2 * 86_400_000;
    expect((await call('GET', '/api/manage', undefined, first)).status).toBe(401);
    expect((await call('GET', '/api/manage', undefined, second)).status).toBe(200);
  });

  it('says which build of the page it came with on every reply of the API, refused or not, and nowhere else', async () => {
    const built = await startDashboard(people(store), { signIn, sessionSecret: SECRET, build: 'build-2' });
    expect((await built.call('GET', '/api/session')).headers['x-sift-build']).toBe('build-2');
    const refused = await built.call('GET', '/api/manage');
    expect(refused.status).toBe(401);
    expect(refused.headers['x-sift-build']).toBe('build-2');
    expect((await built.call('GET', '/auth/login')).headers['x-sift-build']).toBeUndefined();
    expect((await (await startDashboard(people(store), { build: 'build-2' })).call('GET', '/api/session')).headers['x-sift-build']).toBe('build-2');
  });

  it('comes back to where the browser started signing in, and only ever to a page of its own', async () => {
    const { call } = await startWithSignIn();
    const from = async (to: string) => (await callback(call, await call('GET', `/auth/login?to=${encodeURIComponent(to)}`), 'abc')).headers['location'];
    expect(await from('/rules?rule=r-1')).toBe('/rules?rule=r-1');
    for (const elsewhere of ['//evil.example', '/\\evil.example', 'https://evil.example', 'rules', '/ evil'])
      expect(await from(elsewhere), elsewhere).toBe('/');
  });

  it('uses HTTPS for the return address and the cookie behind Tailscale serve', async () => {
    const { call } = await startWithSignIn();
    const proxied = { host: 'box.example.ts.net', 'x-forwarded-proto': 'https' };
    const login = await call('GET', '/auth/login', undefined, proxied);
    expect(String(login.headers['location'])).toContain(encodeURIComponent('https://box.example.ts.net/auth/callback'));
    const back = await callback(call, login, 'abc', proxied);
    expect(String(back.headers['set-cookie'])).toMatch(/; Secure$/);
  });

  it('explains why sign-in is not possible at a plain address or without a client', async () => {
    const { call, port } = await startWithSignIn();
    const plain = await call('GET', '/api/session', undefined, { host: `homebox:${port}` });
    expect(plain.body).toMatchObject({ canSignIn: false, reason: 'address', addresses: ['http://localhost:1', 'https://box.example.ts.net'] });
    expect((await call('GET', '/auth/login', undefined, { host: `homebox:${port}` })).headers['location']).toBe('/');

    hasClient = false;
    expect((await call('GET', '/api/session')).body).toMatchObject({ canSignIn: false, reason: 'no-client' });
  });

  it('says a sign-in failed and logs why, and adds a second account only for someone signed in', async () => {
    const { call } = await startWithSignIn();
    const login = await call('GET', '/auth/login?add=1');
    const refused = await callback(call, login, 'refused');
    expect(decodeURIComponent(String(refused.headers['location']))).toBe('/?signin=Google did not complete the sign-in.');
    expect(logged).toEqual(['GET /auth/callback: invalid_grant']);
    expect(String(refused.headers['set-cookie'])).not.toContain('sift_session');
    expect(completed.at(-1)).toContain('addTo=null');

    const first = await call('GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await callback(call, first, 'abc')).headers) };
    const add = await call('GET', '/auth/login?add=1', undefined, cookie);
    const added = await callback(call, add, 'second', cookie);
    // The account being added joins the mailboxes of whoever is signed in, who stays signed in as themselves.
    expect(completed.at(-1)).toContain(`addTo=${ACCOUNT}`);
    expect(added.headers['location']).toBe('/?settings=1');
    expect(String(added.headers['set-cookie'])).not.toContain('sift_session');
    expect((await call('GET', '/api/session', undefined, cookie)).body).toMatchObject({ email: ACCOUNT });

    // Someone else's is refused, rather than signing in as them; said in Settings, as is any failure while signed in.
    const taken = await callback(call, await call('GET', '/auth/login?add=1', undefined, cookie), 'taken', cookie);
    expect(decodeURIComponent(String(taken.headers['location']))).toBe('/?settings=1&signin=bravo@example.net is already connected to Mild by someone else.');
    expect(String(taken.headers['set-cookie'])).not.toContain('sift_session');
    const asked = await call('GET', '/auth/login?add=1', undefined, cookie);
    const denied = await call('GET', `/auth/callback?state=${stateFrom(asked.headers)}&error=access_denied`, undefined, {
      cookie: `${cookie.cookie}; ${cookieFrom(asked.headers)}`,
    });
    expect(denied.headers['location']).toBe('/?settings=1&signin=Google%20did%20not%20grant%20access.');
  });

  it('asks Google to let Mild send only for a mailbox of whoever is signed in, and only they finish it', async () => {
    const { call } = await startWithSignIn();
    expect((await call('GET', `/auth/login?grant=send&mailbox=${ACCOUNT}`)).headers['location']).toBe('/');
    const cookie = { cookie: cookieFrom((await callback(call, await call('GET', '/auth/login'), 'abc')).headers) };
    expect((await call('GET', '/auth/login?grant=send&mailbox=bravo@example.net', undefined, cookie)).headers['location']).toBe('/');

    const grant = await call('GET', `/auth/login?grant=send&mailbox=${ACCOUNT}&to=/inbox`, undefined, cookie);
    expect(String(grant.headers['location'])).toContain(`&send=${ACCOUNT}`);
    // Signed out before Google came back.
    expect(String((await callback(call, grant, 'abc')).headers['location'])).toContain('let%20Mild%20send');
    const again = await call('GET', `/auth/login?grant=send&mailbox=${ACCOUNT}&to=/inbox`, undefined, cookie);
    const back = await callback(call, again, 'abc', cookie);
    expect(completed.at(-1)).toContain(`addTo=null send=${ACCOUNT}`);
    expect(back.headers['location']).toBe('/inbox');
    expect(String(back.headers['set-cookie'])).not.toContain('sift_session');
  });

  it('completes a sign-in only in the browser that started it', async () => {
    const { call } = await startWithSignIn();
    const login = await call('GET', '/auth/login');
    // The consent link, followed in another browser: Google returns there with the state but no cookie.
    const elsewhere = await call('GET', `/auth/callback?state=${stateFrom(login.headers)}&code=abc`);
    expect(String(elsewhere.headers['location'])).toContain('another%20browser');
    expect(String(elsewhere.headers['set-cookie'])).not.toContain('sift_session=s');
    expect(completed).toEqual([]);
  });

  it('adds a mailbox only to the person still signed in where it was started', async () => {
    const { call } = await startWithSignIn();
    const first = await call('GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await callback(call, first, 'abc')).headers) };
    const add = await call('GET', '/auth/login?add=1', undefined, cookie);
    // Signed out before Google came back: the mailbox would join someone no longer here.
    const back = await callback(call, add, 'second');
    expect(String(back.headers['location'])).toContain('Sign%20in%20again');
    expect(completed).toHaveLength(1);
  });

  it('ends a session on sign-out, when it expires, and when its account is removed', async () => {
    const { call } = await startWithSignIn();
    const login = await call('GET', '/auth/login');
    const cookie = { cookie: cookieFrom((await callback(call, login, 'abc')).headers) };
    const out = await call('POST', '/api/signout', {}, cookie);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');

    await raw(store.central).run('DELETE FROM accounts');
    expect((await call('GET', '/api/summary', undefined, cookie)).status).toBe(401);
  });

  it('does not believe a forwarded scheme from another machine', async () => {
    // Every test request comes from this machine, so this checks the header alone is not enough to be
    // offered sign-in at a name that is not localhost.
    const { call, port, handle } = await startWithSignIn();
    expect((await call('GET', '/api/session', undefined, { host: `homebox:${port}`, 'x-forwarded-proto': 'http' })).body).toMatchObject({
      canSignIn: false,
    });
    // The handler takes the scheme from the URL, which its host builds; a forwarded header alone does nothing.
    const offered = async (url: string) =>
      ((await (await handle(new Request(url, { headers: { host: 'homebox', 'x-forwarded-proto': 'https' } }))).json()) as { canSignIn: boolean }).canSignIn;
    expect(await offered('https://homebox/api/session')).toBe(true);
    expect(await offered('http://homebox/api/session')).toBe(false);
  });
});
