/**
 * This page load's trace, chosen as the page starts (`web/src/lib/telemetry.ts`). A call to the API made before the SDK
 * is up carries it, and the page load's span continues it once there is one, so the first calls a screen makes are
 * under it too. Empty on the server.
 */
const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
export const opening = 'document' in globalThis ? `${hex(16)}-${hex(8)}-1` : '';

// Until the SDK is up, which adds its own, or the server says nothing is sent.
let carrying = opening !== '';

/** No longer carried by calls to the API. */
export const stopCarrying = () => void (carrying = false);

/** What a call to the API carries to be part of the page load's trace. */
export const traceHeaders = (): Record<string, string> => (carrying ? { 'sentry-trace': opening } : {});
