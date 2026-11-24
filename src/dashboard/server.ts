import type { People } from '../store/people.ts';
import { headOf } from '../store/changes.ts';
import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import { DOWNLOADS, FRAMES, READS, WRITES } from './api/index.ts';
import type { Context, Write } from './api/route.ts';
import { frameNote } from './mail-html.ts';
import { Refusal } from '../refusal.ts';
import { asked, identify, httpStatus, reportError, traced } from '../telemetry.ts';
import type { Controls, SignIn } from './controls.ts';
import { type Scope, narrow, scopeFor, sees } from './scope.ts';
import { NOSNIFF } from './policy.ts';
import { cookie, fileHeaders, frameHeaders, json, readJson, refusedBy, replied, streamed } from './http.ts';
import { DEVICE_ID, cookies, readSession } from './session.ts';
import { SIGN_IN_PATHS, type SignInOptions, type Visit, answerDevice, answerSignIn } from './sign-in.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const MAX_BODY = 20_000;

export interface DashboardOptions {
  /** Names and addresses, besides localhost, that the dashboard answers to. */
  allowedHosts?: readonly string[];
  /** False: the scheme in a request's URL, which says only what a proxy claimed, is not believed, and the request is taken as plain HTTP. */
  forwarded?: boolean;
  /**
   * Google sign-in. When given, the dashboard's data and controls are only for someone signed in as a
   * connected account. Without it (tests, tools) there is no check.
   */
  signIn?: SignIn;
  /** Signs session cookies. Required with `signIn`. */
  sessionSecret?: string;
  /** Where a sign-in waits between leaving for Google and coming back, which may reach another instance. Required with `signIn`. */
  ephemeral?: Ephemeral;
  /** Addresses Google can sign the user in at, to suggest when they opened the dashboard at one it cannot. */
  signInAddresses?: readonly string[];
  /** `MILD_CLOUD`: this Mild is a service for other people, with terms, a privacy policy and a security page. */
  cloud?: boolean;
  /**
   * Which build of the page this server came with (`MILD_BUILD`, next.config.js), said on every `/api/` reply
   * (`x-sift-build`) so a page left open across an update notices at its next call.
   */
  build?: string | null;
  /** What the dashboard can ask the rest of Mild to do. Without it the page can look but not manage. */
  controls?: Controls;
  /** Where an error goes that is Mild's own, not a `Refusal`: the page is told only that something failed. */
  log?: (line: string) => void;
  now?: () => number;
}

export interface Dashboard {
  /** Whether a request with this Host header is for the dashboard. One that is not is refused by `handle`. */
  answers: (host: string | null | undefined) => boolean;
  /** Everything but the page's own files. The scheme is the URL's, where `forwarded` believes it. */
  handle: (request: Request) => Promise<Response>;
}

const hostname = (host: string | null | undefined) => (host ?? '').replace(/:\d+$/, '').toLowerCase();

/**
 * The dashboard: where the user watches Mild, teaches it and manages it.
 *
 * Who may use it: someone signed in with Google as a connected account. That one sign-in is also what
 * gives Mild its access to the account. Requests must be addressed to localhost or one of this
 * machine's own names (which stops another website reaching it through DNS rebinding), and every write
 * must come from the dashboard's own page. The page's static files, its app manifest and service worker
 * among them, are public, hold no data and are served by the adapter; everything under `/api/` needs the
 * session.
 *
 * What it may do: change what Mild has been taught and how it is set up. It never reaches Gmail itself;
 * the few things that do (signing in, undo, reading the inbox) are handed in and audited as usual.
 */
export function createDashboard(people: People, options: DashboardOptions = {}): Dashboard {
  const now = options.now ?? Date.now;
  const hosts = new Set([...LOCAL_HOSTS, ...(options.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  const answers = (host: string | null | undefined) => hosts.has(hostname(host));
  const { controls, signIn } = options;
  const secret = options.sessionSecret ?? '';
  if (signIn && secret === '') throw new Error('signIn needs a sessionSecret');
  const { ephemeral } = options;
  if (signIn && !ephemeral) throw new Error('signIn needs an ephemeral store');
  const log = options.log ?? (() => {});
  const cloud = options.cloud ?? false;
  const build = options.build ?? null;
  const report = (request: Request, error: unknown) =>
    log(`${request.method} ${new URL(request.url).pathname}: ${error instanceof Error ? error.message : String(error)}`);
  /** What the page is told of an error: a refusal's own words, anything else only that it failed. */
  const failed = (request: Request, error: unknown): { status: number; error: string } => {
    if (error instanceof Refusal) return { status: 409, error: error.message };
    report(request, error);
    reportError(error);
    return { status: 500, error: 'Mild could not do that. Why is in its log.' };
  };
  /**
   * A write must come from the dashboard's own page: a browser sends Origin on every cross-site request, and another site
   * cannot set a custom header or a JSON content type without a preflight this server never approves.
   */
  const fromOwnPage = (request: Request) => {
    let origin: string | null = null;
    try {
      origin = new URL(request.headers.get('origin') ?? '').hostname.toLowerCase();
    } catch {
      origin = null;
    }
    return (
      origin !== null &&
      hosts.has(origin.includes(':') ? `[${origin}]` : origin) &&
      request.headers.get('x-sift') === '1' &&
      (request.headers.get('content-type') ?? '').startsWith('application/json')
    );
  };
  const signInOptions: SignInOptions = {
    people,
    signIn,
    ephemeral,
    secret,
    signInAddresses: options.signInAddresses ?? [],
    cloud,
    now,
    report,
    fromOwnPage,
  };
  const refuse = async (id: number): Promise<never> => {
    throw new Error(`Nobody is signed in to open person ${id}'s database.`);
  };
  const reads = new Map(READS.map((route) => [route.path, route]));
  const frames = new Map(FRAMES.map((route) => [route.path, route]));
  const downloads = new Map(DOWNLOADS.map((route) => [route.path, route]));
  const writes = new Map(WRITES.map((route) => [route.path, route]));
  /** Why this person may not make this write, or null if they may. Someone else's data is reported as not there. */
  const refusal = async (route: Write, ctx: Context, body: unknown, scope: Scope, someone: boolean): Promise<{ status: number; error: string } | null> => {
    const whose = await route.touches(ctx, body);
    if (whose === 'self') return someone ? null : { status: 401, error: 'Sign in to use the dashboard.' };
    if (whose === null || whose === 'anyone' || sees(scope, whose.account)) return null;
    return { status: 404, error: 'There is no such thing here.' };
  };

  /** Named by its route, never by a path a stranger chose. */
  const routeOf = (path: string) =>
    reads.has(path) || writes.has(path) || frames.has(path) || downloads.has(path) || SIGN_IN_PATHS.has(path) ? path : 'other';

  const handle = async (request: Request): Promise<Response> => {
    // The Host header, not the URL: a `node:http` adapter cannot always build a URL from it.
    const hostHeader = request.headers.get('host');
    if (!answers(hostHeader)) {
      return new Response('The Mild dashboard does not answer to this address. Set MILD_URL to it.', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      });
    }
    const host = hostname(hostHeader);

    const url = new URL(request.url);
    const query = url.searchParams;

    const https = options.forwarded !== false && url.protocol === 'https:';
    const origin = `${https ? 'https' : 'http'}://${hostHeader ?? ''}`;
    // Google only returns a browser to localhost or to an HTTPS address.
    const googleCanReturnHere = https || LOCAL_HOSTS.has(host);
    const issued = signIn ? readSession(cookie(request, 'sift_session'), secret, now()) : null;
    // A session is for one person: once its mailbox has been removed, and perhaps signed in to again by someone new, it is no one's.
    const found = issued !== null ? await people.signedIn(issued.email) : null;
    const known = found?.id === issued?.person ? found : null;
    const session = known ? issued!.email : null;
    // What this request may see: the mailboxes of whoever is signed in, in their own database and no
    // one else's. With no sign-in set up (tests, tools) it is the owner's.
    const person = signIn ? known : await people.owner();
    if (person) identify({ id: person.id, email: session });
    const whole = person ? scopeFor(person.accounts, person.owner) : scopeFor([], !signIn);
    const ctx: Context = {
      db: person ? await person.open(person.id) : people.nobody,
      open: person ? person.open : refuse,
      person,
      signedInAs: session,
      controls,
      said: (error) => failed(request, error).error,
      now,
    };
    const given = cookie(request, 'sift_device') ?? '';
    const visit: Visit = {
      request,
      url,
      https,
      origin,
      googleCanReturnHere,
      issued,
      session,
      person,
      db: ctx.db,
      device: DEVICE_ID.test(given) ? given : null,
    };
    const { method } = request;

    const signedOut = await answerSignIn(visit, signInOptions);
    if (signedOut) return signedOut;
    if (signIn && session === null && url.pathname.startsWith('/api/')) return json(401, { error: 'Sign in to use the dashboard.' });
    const device = await answerDevice(visit, signInOptions);
    if (device) return device;

    if (method === 'POST') {
      const handler = writes.get(url.pathname);
      if (!handler) return json(405, { error: 'Not something this dashboard does.' });
      if (!fromOwnPage(request)) return json(403, { error: 'This request did not come from the dashboard.' });
      try {
        const raw = await readJson(request, handler.largest ?? MAX_BODY);
        if (raw === null) return json(400, { error: 'That request is not well formed.' });
        const body = handler.body.safeParse(raw);
        if (!body.success) return json(400, { error: refusedBy(body.error) });
        const refused = await refusal(handler, ctx, body.data, whole, person !== null);
        if (refused) return json(refused.status, { error: refused.error });
        const result: unknown = await handler.run(ctx, body.data, whole);
        if (result === null) return json(400, { error: 'That request is not well formed.' });
        const reply = replied(handler.reply, result);
        if (reply.status === 200 && handler.endsSession?.(reply.body)) return json(200, reply.body, { 'set-cookie': cookies(https).session('', 0) });
        // How far this write brought the person's copy: the page's copy holds its change once it has read that far.
        return json(reply.status, reply.body, person ? { 'x-sift-seq': String((await headOf(ctx.db)).seq) } : {});
      } catch (error) {
        const { status, ...body } = failed(request, error);
        return json(status, body);
      }
    }
    if (method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });

    const shown = frames.get(url.pathname);
    if (shown) {
      const mailbox = query.get('mailbox');
      const scope = mailbox ? narrow(whole, mailbox) : whole;
      const params = shown.query.safeParse(Object.fromEntries(query));
      const reply: { status: number; html: string; images?: boolean } = !scope
        ? { status: 404, html: frameNote('There is no such message here.') }
        : !params.success
          ? { status: 400, html: frameNote(refusedBy(params.error)) }
          : await shown.run(ctx, scope, params.data).catch((error: unknown) => {
              const { status, error: note } = failed(request, error);
              return { status, html: frameNote(note) };
            });
      return new Response(reply.html, { status: reply.status, headers: frameHeaders(reply.images === true) });
    }
    const saved = downloads.get(url.pathname);
    if (saved) {
      const mailbox = query.get('mailbox');
      const scope = mailbox ? narrow(whole, mailbox) : whole;
      if (!scope) return json(404, { error: 'No such mailbox' });
      const params = saved.query.safeParse(Object.fromEntries(query));
      if (!params.success) return json(400, { error: refusedBy(params.error) });
      try {
        const file = await saved.run(ctx, scope, params.data);
        if (!file) return json(404, { error: 'There is no such file here.' });
        return new Response(streamed(file.data), { status: 200, headers: fileHeaders(file.name, file.type) });
      } catch (error) {
        const { status, ...body } = failed(request, error);
        return json(status, body);
      }
    }
    if (url.pathname.startsWith('/api/')) {
      const route = reads.get(url.pathname);
      if (!route) return json(404, { error: 'Not found' });
      // `mailbox` narrows any read to one of the person's own mailboxes.
      const mailbox = query.get('mailbox');
      const scope = mailbox ? narrow(whole, mailbox) : whole;
      if (!scope) return json(404, { error: 'No such mailbox' });
      const params = route.query.safeParse(Object.fromEntries(query));
      if (!params.success) return json(400, { error: refusedBy(params.error) });
      try {
        const reply = await route.run(ctx, scope, params.data);
        const sent = reply.status === 200 ? replied(route.reply, reply.body) : reply;
        return json(sent.status, sent.body);
      } catch (error) {
        const { status, ...body } = failed(request, error);
        return json(status, body);
      }
    }
    return new Response('Not found', { status: 404, headers: { ...NOSNIFF, 'content-type': 'text/plain' } });
  };

  return {
    answers,
    handle: (request) => {
      const { pathname, protocol } = new URL(request.url);
      const route = routeOf(pathname);
      const server = {
        'http.request.method': request.method,
        'http.route': route,
        'url.scheme': protocol.slice(0, -1),
        'user_agent.original': request.headers.get('user-agent') ?? undefined,
      };
      return asked(request.headers, () =>
        traced('http.server', `${request.method} ${route}`, server, async (span) => {
          const response = await handle(request).catch((error: unknown) => {
            const { status, ...body } = failed(request, error);
            return json(status, body);
          });
          httpStatus(span, response.status);
          if (build && pathname.startsWith('/api/')) response.headers.set('x-sift-build', build);
          return response;
        }),
      );
    },
  };
}
