import type { Session } from './api.ts';
import type { captureMessage } from './telemetry-sdk.ts';
import { opening, stopCarrying } from './trace.ts';

/**
 * How long the page took to load and to go between screens, and what failed in it, sent to the server's Sentry project
 * (`telemetry` in the session). The SDK is reached only from here (`telemetry-sdk.ts`), so everything sent passes `scrub`.
 * Each `/api/` call carries the trace it is part of, so the server's work is under the load or the press that asked.
 */

const ADDRESS = /[^\s@<>()[\]"'`,;:/\\]+(?:@|%40)[^\s@<>()[\]"'`,;:/\\]+\.[a-z]{2,}/gi;
// A link's query names a message, an account or a sender (`?message=…`); the path is kept without it.
const QUERY = /(\/[^\s?#"]*)\?[^\s#"]*/g;
const QUERY_KEYS = new Set(['http.query', 'url.query', 'http.fragment', 'url.fragment']);

// A sender's or domain's page names them in its path, and a rule's or label's its id; each is named by its route
// instead, so one route is one name. The API's own paths (`/api/rules/inbox`) are not pages.
const ADDRESSED = /(?<!\/api)\/(sender|domain|rules|labels)\/[^/\s?#"]+/g;
const PARAM = { sender: 'address', domain: 'domain', rules: 'id', labels: 'id' } as const;
const routeOf = (text: string) => text.replace(ADDRESSED, (_, page: keyof typeof PARAM) => `/${page}/:${PARAM[page]}`);

/** `value` with every link's query, every sender's or domain's page and every address taken out, at any depth. */
function scrub<T>(value: T): T {
  // The query first: an address in it would otherwise take its `?` with it.
  if (typeof value === 'string') return routeOf(value.replace(QUERY, '$1')).replace(ADDRESS, '[address]') as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, inner]) => (QUERY_KEYS.has(key) ? [] : [[key, scrub(inner)]]))) as T;
}

/**
 * Start sending where the server said, once. The SDK is fetched only then, apart from the page's own code: the calls
 * made before it arrives already carry the page load's trace (`traceHeaders`, `web/src/lib/trace.ts`).
 */
export function startTelemetry(where: Session['telemetry']): void {
  if (!where) stopCarrying();
  if (!where || !opening || document.querySelector('meta[name="sentry-trace"]')) return;
  const meta = document.createElement('meta');
  meta.name = 'sentry-trace';
  meta.content = opening;
  document.head.append(meta);
  void import('./telemetry-sdk.ts')
    .then(({ browserTracingIntegration, captureMessage, init }) => {
      init({
        dsn: where.dsn,
        ...(where.release ? { release: where.release } : {}),
        ...(where.environment ? { environment: where.environment } : {}),
        integrations: [browserTracingIntegration({ beforeStartSpan: (span) => ({ ...span, name: routeOf(span.name) }) })],
        // One person's dashboard: every load is worth having.
        tracesSampleRate: 1,
        // What was clicked and logged can quote the mail on screen.
        beforeBreadcrumb: () => null,
        beforeSend: (event) => scrub(event),
        beforeSendSpan: (span) => scrub(span),
      });
      stopCarrying();
      watchFreezes(captureMessage);
    })
    .catch(() => {});
}

/** A frame this long is the page not answering, which the person feels whatever caused it. */
const FROZE_MS = 500;
// One cause tends to freeze the page again and again; the first few say it.
const MOST_A_LOAD = 5;
const APART_MS = 10_000;

type Frame = PerformanceEntry & {
  blockingDuration: number;
  scripts: { invoker: string; invokerType: string; sourceURL: string; sourceFunctionName: string; sourceCharPosition: number; duration: number }[];
};

/**
 * Each frame of 500 ms or more while the page is in front of the person, as an error in Sentry, grouped by the screen
 * and what started the work (a timer, a click, a database read) since the functions' names change with every build.
 * Only Chromium reports long frames.
 */
function watchFreezes(tell: typeof captureMessage) {
  if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) return;
  let told = 0;
  let last = -APART_MS;
  const observer = new PerformanceObserver((list) => {
    for (const frame of list.getEntries() as Frame[]) {
      if (frame.duration < FROZE_MS || document.visibilityState !== 'visible' || frame.startTime - last < APART_MS) continue;
      last = frame.startTime;
      const scripts = frame.scripts
        .toSorted((a, b) => b.duration - a.duration)
        .slice(0, 5)
        .map((s) => ({
          invoker: s.invoker,
          function: s.sourceFunctionName || '(anonymous)',
          source: `${s.sourceURL.split('/').pop()}:${s.sourceCharPosition}`,
          ms: Math.round(s.duration),
        }));
      const screen = routeOf(location.pathname);
      tell(`The page froze for ${(frame.duration / 1000).toFixed(1)} s`, {
        level: 'error',
        fingerprint: ['freeze', screen, scripts[0]?.invoker ?? 'rendering'],
        tags: { screen },
        contexts: { freeze: { ms: Math.round(frame.duration), blocking_ms: Math.round(frame.blockingDuration), scripts } },
      });
      if (++told === MOST_A_LOAD) return observer.disconnect();
    }
  });
  observer.observe({ type: 'long-animation-frame', buffered: true });
}

/** A failure the page caught itself (`Failed`), which the SDK would otherwise never see. Dropped when nothing was started. */
export function reportError(error: unknown): void {
  void import('./telemetry-sdk.ts').then(({ captureException }) => captureException(error)).catch(() => {});
}

/**
 * A panel opened over the screen (Settings, a message, the composer) as a navigation of its own, named for it: only the
 * address's query changed, which starts none, so what it waits on and the long frames meanwhile would be under nothing.
 */
export function panelOpened(panel: 'Settings' | 'Message' | 'Composer'): void {
  if (!document.querySelector('meta[name="sentry-trace"]')) return;
  void import('./telemetry-sdk.ts')
    .then(({ getClient, startBrowserTracingNavigationSpan }) => {
      const client = getClient();
      if (client) startBrowserTracingNavigationSpan(client, { name: panel, op: 'navigation', attributes: { 'sentry.source': 'custom' } });
    })
    .catch(() => {});
}
