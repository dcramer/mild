import * as Sentry from '@sentry/node';

/**
 * Errors and traces, sent to Sentry when `SENTRY_DSN` is set. The only module that imports the SDK.
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
 * Start sending errors and traces, if there is somewhere to send them. Called once by each host. Nothing
 * is instrumented on its own: no HTTP, database or AI library integration, no breadcrumbs, no local
 * variables, since each would carry what came from mail. Only the spans sift makes go out.
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
    Sentry.startSpan({ op, name: scrubText(name), attributes: defined({ ...carried, ...attributes }) }, (span) =>
      work({
        set: (more) => span.setAttributes(defined(more)),
        fail: () => span.setStatus({ code: 2, message: 'internal_error' }),
      }),
    );
  return await (parent ? start() : Sentry.withIsolationScope(start));
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
