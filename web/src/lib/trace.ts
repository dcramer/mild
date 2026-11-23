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

type Attributes = Record<string, string | number | boolean>;
/** What the page timed itself, in ms from when it opened; no start is from when the screen began (`useShown`, `web/src/lib/telemetry.ts`). */
export interface Timing {
  name: string;
  op: string;
  start: number | null;
  end: number;
  attributes: Attributes;
}
// Most of what a screen waits on (the frame and the copy from the device, the first calls) is done before the SDK is up.
const early: Timing[] = [];
const MOST_EARLY = 200;
let record: ((timing: Timing) => void) | null = null;

/** Every timing from now on to `to`, those kept before it first. */
export function drain(to: (timing: Timing) => void): void {
  record = to;
  for (const timing of early.splice(0)) to(timing);
}

/** Work the page did from `start` (`performance.now()`) until now, as a span under the screen it was done for. */
export function timed(name: string, op: string, start: number | null, attributes: Attributes = {}): void {
  const timing = { name, op, start, end: performance.now(), attributes };
  if (record) record(timing);
  else if (early.length < MOST_EARLY) early.push(timing);
}

/**
 * Whether a call to the API starting now is one the SDK does not see, since it is not up yet: the page times it itself
 * (`called`), as it is when it answers, which may be after the SDK is up.
 */
export const unseen = (): boolean => !record && opening !== '';

/** A call to the API the SDK did not see begin, as a span under the page load. */
export function called(method: string, path: string, start: number, status: number | null): void {
  timed(`${method} ${path.split('?')[0]}`, 'http.client', start, status === null ? {} : { 'http.response.status_code': status });
}
