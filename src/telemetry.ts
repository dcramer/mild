import * as Sentry from '@sentry/node';

/**
 * Errors, traces, logs and the tick's check-ins, sent to Sentry when `SENTRY_DSN` is set. The only module
 * that imports the SDK. Spans follow OpenTelemetry's semantic conventions, so Sentry's views for queries,
 * caches, outgoing requests and AI agents read them.
 *
 * Nothing that identifies mail may leave the machine: what a span says of a message is a keyed hash
 * (`traceIds`, src/store/content.ts), and the model's prompt and answer are never put on one. `scrub`
 * runs on everything on its way out, in case something was put there anyway.
 */

type Value = string | number | boolean;
export type Attributes = Record<string, Value | undefined>;

/** What a piece of work can say on its span once it knows. */
export interface Traced {
  set(attributes: Attributes): void;
  /** Marks the span failed. Why is never given: an error's words can quote the mail. */
  fail(): void;
}

/**
 * Carried from a span to those started under it, so any span can be found by the message or model run it
 * was for, and a model call and its tools belong to their agent's conversation. Who it was for is the
 * scope's user (`identify`), which Sentry puts on every span and error.
 */
const CARRIED = ['sift.message', 'sift.sender', 'sift.domain', 'sift.run_id', 'gen_ai.agent.name', 'gen_ai.conversation.id'];

/**
 * Attributes that would hold the prompt, the answer or a tool call's arguments. Sift never sets them and
 * Sentry's own AI integrations, which would, are not loaded.
 */
const CONTENT = new Set([
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.tool.definitions',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.tool.input',
  'gen_ai.tool.output',
  'gen_ai.request.messages',
  'gen_ai.request.available_tools',
  'gen_ai.response.text',
  'gen_ai.response.tool_calls',
  'gen_ai.prompt',
  'gen_ai.embeddings.input',
]);

/** The one address a span may carry: the connected account's, which is the person it is for. */
const OWN_ADDRESS = 'user.email';

const ADDRESS = /[^\s@<>()[\]"'`,;:/\\]+(?:@|%40)[^\s@<>()[\]"'`,;:/\\]+\.[a-z]{2,}/gi;

const defined = (attributes: Attributes): Record<string, Value> =>
  Object.fromEntries(Object.entries(attributes).filter((entry): entry is [string, Value] => entry[1] !== undefined));

/** Every address in a string replaced. */
const scrubText = (text: string) => text.replace(ADDRESS, '[address]');

/** `value` with every address replaced, at any depth, and content attributes taken out. Only `user.email` is left as it is. */
export function scrub<T>(value: T): T {
  if (typeof value === 'string') return scrubText(value) as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value === null || typeof value !== 'object') return value;
  const kept: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (CONTENT.has(key)) continue;
    kept[key] = key === OWN_ADDRESS ? inner : scrub(inner);
  }
  return kept as T;
}

/**
 * Start sending, if there is somewhere to send to. Called once by each host. Nothing is instrumented on
 * its own: no HTTP, database or AI library integration, no breadcrumbs, no local variables, since each
 * would carry what came from mail. Only the spans and logs sift makes go out. The release is the commit
 * Vercel or `SENTRY_RELEASE` names.
 */
export function startTelemetry(dsn: string | undefined, options: { environment?: string; transport?: Sentry.NodeOptions['transport'] } = {}): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    ...options,
    defaultIntegrations: false,
    integrations: [
      Sentry.linkedErrorsIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.contextLinesIntegration(),
    ],
    // Every pass is a trace: a person's mail is classified a minute at a time, and a dropped pass loses its model calls.
    tracesSampleRate: 1,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    beforeBreadcrumb: () => null,
    // The user is only what `identify` set: the person's id and their own address.
    beforeSend: (event) => ({ ...scrub({ ...event, request: undefined, breadcrumbs: undefined, user: undefined }), user: event.user }),
    beforeSendSpan: (span) => scrub(span),
    beforeSendLog: (log) => scrub(log),
  });
}

/**
 * Run `work` as a span. A span started inside it is its child and carries its message and run. One started
 * outside any (a request, a piece of work) gets a scope of its own, so whom it is `identify`d as is said of
 * it and of nothing running beside it.
 */
export async function traced<T>(op: string, name: string, attributes: Attributes, work: (span: Traced) => Promise<T>): Promise<T> {
  const parent = Sentry.getActiveSpan();
  const above = parent ? Sentry.spanToJSON(parent).attributes : {};
  const carried: Attributes = {};
  for (const key of CARRIED) {
    const value = above[key];
    if (typeof value === 'string' || typeof value === 'number') carried[key] = value;
  }
  const start = () =>
    Sentry.startSpan({ op, name: scrubText(name), attributes: defined({ ...carried, ...attributes }) }, async (span) => {
      try {
        return await work({
          set: (more) => span.setAttributes(defined(more)),
          fail: () => span.setStatus({ code: 2, message: 'internal_error' }),
        });
      } catch (error) {
        // The class alone: an error's words can quote the mail.
        span.setAttribute('error.type', error instanceof Error ? error.constructor.name : typeof error);
        throw error;
      }
    });
  return await (parent ? start() : Sentry.withIsolationScope(start));
}

const untraced: Traced = { set: () => {}, fail: () => {} };

/** As `traced`, but only under a span already started: on its own it would be a trace of one query. */
export const within = <T>(op: string, name: string, attributes: Attributes, work: (span: Traced) => Promise<T>): Promise<T> =>
  Sentry.getActiveSpan() ? traced(op, name, attributes, work) : work(untraced);

/**
 * What an `http.client` span says of a request: the method and where it went, as `url.template` when the
 * path would name a message. Never the query, which may carry a code or a token, or either body.
 */
export function clientRequest(method: string, url: string, template?: string): { name: string; attributes: Attributes } {
  const { protocol, hostname, port, origin, pathname } = new URL(url);
  const where = `${origin}${template ?? pathname}`;
  return {
    name: `${method} ${where}`,
    attributes: {
      'http.request.method': method,
      'server.address': hostname,
      'server.port': Number(port || (protocol === 'https:' ? 443 : 80)),
      ...(template ? { 'url.template': template } : { 'url.full': where }),
    },
  };
}

/** Set a reply's status on its `http.client` or `http.server` span. A 5xx fails it; a 4xx is the caller's to judge. */
export function httpStatus(span: Traced, status: number): void {
  span.set({ 'http.response.status_code': status, ...(status >= 500 ? { 'error.type': String(status) } : {}) });
  if (status >= 500) span.fail();
}

/**
 * `fetch` as an `http.client` span. `propagate` sends the trace along, for a call to Sift's own
 * deployment, so the work it starts is part of the same trace.
 */
export const tracedFetch = (url: string, init: RequestInit & { method: string }, propagate = false): Promise<Response> => {
  const { name, attributes } = clientRequest(init.method, url);
  return traced('http.client', name, attributes, async (span) => {
    const headers = propagate ? { ...(init.headers as Record<string, string>), ...Sentry.getTraceData() } : init.headers;
    const response = await fetch(url, { ...init, ...(headers ? { headers } : {}) });
    httpStatus(span, response.status);
    return response;
  });
};

/** Run `work` as part of the trace a call from Sift's own deployment carried in (`tracedFetch`'s `propagate`). */
export const continued = <T>(headers: Headers, work: () => Promise<T>): Promise<T> =>
  Sentry.continueTrace({ sentryTrace: headers.get('sentry-trace') ?? undefined, baggage: headers.get('baggage') ?? undefined }, work);

/**
 * Run `work` as one check-in of the tick that runs every minute, so Sentry says when it stops, fails or
 * runs long.
 */
export const checkedIn = <T>(work: () => Promise<T>): Promise<T> =>
  Sentry.withMonitor('tick', work, {
    schedule: { type: 'crontab', value: '* * * * *' },
    checkinMargin: 2,
    maxRuntime: 5,
  });

/** A line of what Sift is doing, as the host writes it, sent as a log beside the trace it was written in. */
export function logged(line: string): void {
  Sentry.logger.info(line);
}

/**
 * Say whom the request or piece of work under way is for: the person, by id, and the address they signed in
 * as or whose mailbox it is. Every span and error in it names them, which is how Sentry finds a person's
 * traces, errors and conversations with the model.
 */
export function identify(person: { id: number; email?: string | null | undefined }): void {
  Sentry.getIsolationScope().setUser({ id: String(person.id), ...(person.email ? { email: person.email } : {}) });
}

/**
 * Run `work` as a `gen_ai.invoke_agent` span, a conversation of its own in Sentry, named by `conversation`:
 * the person and what it is recorded as in their database (a model run, a label proposal, a rule draft, a
 * test run's message), so a retry, which shares nothing with the try before, is a conversation of its own.
 * `attributes` name that record. Fails when `work` settles `failed`.
 */
export const invokeAgent = <T extends object>(
  agent: string,
  conversation: readonly (number | null)[],
  attributes: Attributes,
  work: () => Promise<T>,
): Promise<T> =>
  traced(
    'gen_ai.invoke_agent',
    `invoke_agent ${agent}`,
    { ...attributes, 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': agent, 'gen_ai.conversation.id': [agent, ...conversation].join('-') },
    async (span) => {
      const settled = await work();
      if ('failed' in settled) span.fail();
      return settled;
    },
  );

/** An error Sift could not deal with, sent with the trace it happened in. */
export function reportError(error: unknown): void {
  Sentry.captureException(error);
}

/** Send what is waiting. A host that stops between requests (Vercel) calls it before it does. */
export async function flushTelemetry(): Promise<void> {
  await Sentry.flush(2000);
}
