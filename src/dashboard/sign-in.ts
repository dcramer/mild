import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { People, Person } from '../store/people.ts';
import { credentials } from '../store/credentials.ts';
import type { Sql } from '../store/sql.ts';
import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import { Refusal } from '../refusal.ts';
import { forThePage } from '../telemetry.ts';
import type { SignIn } from './controls.ts';
import { cookie, json, redirect } from './http.ts';
import { NOSNIFF } from './policy.ts';
import { DEVICE_DAYS, RENEW_MS, SESSION_DAYS, cookies, signSession } from './session.ts';
import { DAY_MS } from '../time.ts';

/** Answered here rather than by a route module. */
export const SIGN_IN_PATHS = new Set(['/auth/login', '/auth/callback', '/api/session', '/api/signout', '/api/device']);

/** A sign-in in flight: the PKCE verifier, whose mailbox it adds or lets send, and where to return to. */
type PendingSignIn = { verifier: string; redirectUri: string; addTo: string | null; send: string | null; to: string; expires: number };

/** How long a sign-in started here may take to come back from Google. */
const SIGN_IN_MS = 600_000;

/** A path on this site: not `//host` or `/\host`, which a browser reads as another site. */
const LOCAL_PATH = /^\/(?![/\\])[^\s\\]{0,2000}$/;

const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** A sign-in in flight, by the state Google echoes back: the PKCE verifier and where to return to. */
const pendingKey = (state: string) => `signin:google:${state}`;

/** Who is asking, as the server read them from the request. */
export interface Visit {
  request: Request;
  url: URL;
  https: boolean;
  /** This dashboard's own origin, as the browser reached it. */
  origin: string;
  googleCanReturnHere: boolean;
  issued: { email: string; person: number; expires: number } | null;
  /** The mailbox signed in as, when its session is still the person's. */
  session: string | null;
  person: Person | null;
  db: Sql;
  /** This browser's device id, from its cookie. */
  device: string | null;
}

export interface SignInOptions {
  people: People;
  signIn?: SignIn | undefined;
  ephemeral?: Ephemeral | undefined;
  secret: string;
  signInAddresses: readonly string[];
  cloud: boolean;
  now: () => number;
  report: (request: Request, error: unknown) => void;
  fromOwnPage: (request: Request) => boolean;
}

const hasDevice = async (visit: Visit) =>
  visit.person !== null && visit.device !== null && (await (await credentials(visit.db, 'device')).read(visit.device)) !== null;

/** `/api/session`, and signing in with Google (`/auth/login`, `/auth/callback`), which need no session. Null for any other request. */
export async function answerSignIn(visit: Visit, options: SignInOptions): Promise<Response | null> {
  const { request, url, session, issued, person } = visit;
  const { signIn, now, secret } = options;
  const query = url.searchParams;
  const set = cookies(visit.https);
  if (request.method !== 'GET') return null;
  if (url.pathname === '/api/session') {
    const reason = !signIn ? null : !signIn.hasClient() ? 'no-client' : !visit.googleCanReturnHere ? 'address' : null;
    // The page asks every few minutes while it is open, which is when a session is renewed.
    const renewed: Record<string, string> =
      signIn && session && issued && issued.expires - now() < SESSION_DAYS * DAY_MS - RENEW_MS
        ? { 'set-cookie': set.session(signSession({ email: session, person: issued.person }, secret, now()), SESSION_DAYS * 86_400) }
        : {};
    return json(
      200,
      {
        required: Boolean(signIn),
        email: session,
        canSignIn: Boolean(signIn) && reason === null,
        reason,
        addresses: signIn ? options.signInAddresses : [],
        cloud: options.cloud,
        telemetry: forThePage(),
        device: await hasDevice(visit),
      },
      renewed,
    );
  }
  if (!signIn) return null;
  if (url.pathname === '/auth/login') {
    // Letting Mild send is for a mailbox of whoever is signed in.
    const send = query.get('grant') === 'send' ? (query.get('mailbox') ?? '') : null;
    if (!signIn.hasClient() || !visit.googleCanReturnHere || (send !== null && !person?.accounts.includes(send))) return redirect('/');
    const state = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    const redirectUri = `${visit.origin}/auth/callback`;
    // Adding a second account is only for someone already signed in. `to` is where the browser started, and only
    // ever a path on this site: anything else would make the sign-in a way to send someone elsewhere.
    const to = query.get('to') ?? '';
    const pending: PendingSignIn = {
      verifier,
      redirectUri,
      addTo: query.get('add') === '1' && send === null ? session : null,
      send,
      to: LOCAL_PATH.test(to) ? to : '/',
      expires: now() + SIGN_IN_MS,
    };
    await options.ephemeral!.set(pendingKey(state), pending, SIGN_IN_MS);
    return redirect(signIn.url(redirectUri, state, createHash('sha256').update(verifier).digest('base64url'), send), set.signIn(state, SIGN_IN_MS / 1000));
  }
  if (url.pathname === '/auth/callback') {
    const state = query.get('state') ?? '';
    // Taken, so it completes once.
    const entry = state ? await options.ephemeral!.take<PendingSignIn>(pendingKey(state)) : null;
    // Someone still signed in was adding a mailbox or signing in again, so it is said in Settings, where mailboxes are; the sign-in page is only for someone signed out.
    const fail = (message: string) => redirect(`/?${session ? 'settings=1&' : ''}signin=${encodeURIComponent(message)}`, set.signIn('', 0));
    const code = query.get('code');
    if (!entry || entry.expires < now()) return fail('That sign-in expired. Try again.');
    if (!same(cookie(request, 'sift_signin') ?? '', state)) return fail('That sign-in was started in another browser. Start it again here.');
    // A mailbox joins whoever started adding it, so that person must still be the one signed in here.
    if (entry.addTo !== null && session !== entry.addTo) return fail('Sign in again, then add the mailbox.');
    if (entry.send !== null && !person?.accounts.includes(entry.send)) return fail('Sign in again, then let Mild send.');
    if (!code) return fail(query.get('error') === 'access_denied' ? 'Google did not grant access.' : 'Google did not complete the sign-in.');
    try {
      const email = await signIn.complete(entry.redirectUri, code, entry.verifier, entry.addTo, entry.send);
      if (entry.send !== null) return redirect(entry.to, set.signIn('', 0));
      const who = await options.people.signedIn(email);
      if (!who) return fail('Google did not complete the sign-in.');
      // A mailbox added joins whoever is signed in, who stays signed in as themselves, back in Settings where they added it.
      // One already someone else's never changes hands, and signing in as them instead is not what was asked.
      if (entry.addTo !== null)
        return who.id === person?.id ? redirect('/?settings=1', set.signIn('', 0)) : fail(`${email} is already connected to Mild by someone else.`);
      return redirect(entry.to, set.session(signSession({ email, person: who.id }, secret, now()), SESSION_DAYS * 86_400), set.signIn('', 0));
    } catch (error) {
      if (error instanceof Refusal) return fail(error.message);
      options.report(request, error);
      return fail('Google did not complete the sign-in.');
    }
  }
  return null;
}

/** Signing out, and this browser's key (`/api/device`), for someone with a session. Null for any other request. */
export async function answerDevice(visit: Visit, options: SignInOptions): Promise<Response | null> {
  const { request, url, person, device } = visit;
  const set = cookies(visit.https);
  if (options.signIn && request.method === 'POST' && url.pathname === '/api/signout') {
    // The browser's key goes, so a copy left on the device can never be read again, and the browser is told to delete it.
    if (person && device) await (await credentials(visit.db, 'device')).remove(device);
    const headers = new Headers({ ...NOSNIFF, 'content-type': 'application/json', 'cache-control': 'no-store', 'clear-site-data': '"storage"' });
    headers.append('set-cookie', set.session('', 0));
    headers.append('set-cookie', set.device('', 0));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }
  // The key this browser's copy of the person's mail is encrypted with (docs/sync.md): read by the page's frame, and made
  // by the page the first time, since a page drawn by Next.js cannot set a cookie.
  if (url.pathname === '/api/device' && person) {
    if (request.method === 'GET') return json(200, { key: device ? await (await credentials(visit.db, 'device')).read(device) : null });
    if (request.method === 'POST') {
      if (!options.fromOwnPage(request)) return json(403, { error: 'This request did not come from the dashboard.' });
      const id = randomBytes(16).toString('hex');
      const key = randomBytes(32).toString('base64url');
      await (await credentials(visit.db, 'device')).write(id, key);
      return json(200, { key }, { 'set-cookie': set.device(id, DEVICE_DAYS * 86_400) });
    }
  }
  return null;
}
