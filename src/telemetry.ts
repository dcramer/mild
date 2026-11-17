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

/** Carried from a span to those started under it, so any span can be found by the account, message or model run it was for. */
const CARRIED = ['user.email', 'sift.person', 'sift.message', 'sift.sender', 'sift.domain', 'sift.run_id'];

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
    beforeSend: (event) => scrub({ ...event, request: undefined, breadcrumbs: undefined }),
    beforeSendSpan: (span) => scrub(span),
  });
}

/** Run `work` as a span. A span started inside it is its child and carries its account, message and run. */
export async function traced<T>(op: string, name: string, attributes: Attributes, work: (span: Traced) => Promise<T>): Promise<T> {
  const parent = Sentry.getActiveSpan();
  const above = parent ? Sentry.spanToJSON(parent).attributes : {};
  const carried: Attributes = {};
  for (const key of CARRIED) {
    const value = above[key];
    if (typeof value === 'string' || typeof value === 'number') carried[key] = value;
  }
  return await Sentry.startSpan({ op, name: scrubText(name), attributes: defined({ ...carried, ...attributes }) }, (span) =>
    work({
      set: (more) => span.setAttributes(defined(more)),
      fail: () => span.setStatus({ code: 2, message: 'internal_error' }),
    }),
  );
}

/** An error Sift could not deal with, sent with the trace it happened in. */
export function reportError(error: unknown): void {
  Sentry.captureException(error);
}

/** Send what is waiting. A host that stops between requests (Vercel) calls it before it does. */
export async function flushTelemetry(): Promise<void> {
  await Sentry.flush(2000);
}
