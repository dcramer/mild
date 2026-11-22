// What the page uses of the SDK, by name, so the rest of it (replay, feedback) is left out of the page.
export {
  browserTracingIntegration,
  captureException,
  captureMessage,
  getActiveSpan,
  getClient,
  getRootSpan,
  init,
  spanToJSON,
  startBrowserTracingNavigationSpan,
  startInactiveSpan,
} from '@sentry/browser';
