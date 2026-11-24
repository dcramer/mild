import { onlineManager } from '@tanstack/react-query';
import { called, traceHeaders, unseen } from '../trace.ts';

/** The server answered, and refused. */
export class Refused extends Error {
  status: number;
  /** The settings a deploy still needs, when that is why. */
  missing: string[] | null;
  constructor(status: number, said: Said = {}) {
    super(said.error ?? `The server answered ${status}.`);
    this.status = status;
    this.missing = said.missing ?? null;
  }
}

/** No answer at all: the network is down or Mild is not running. */
export class Unreachable extends Error {}

/**
 * What a failed write means for trying it again: Mild not reached, so again once it is; Mild busy or failing for now
 * (408, 429, a 5xx), so again later; nobody signed in any more; or refused, which asking again will not change.
 */
export function failure(error: unknown): 'unreachable' | 'busy' | 'signed out' | 'refused' {
  if (error instanceof Unreachable) return 'unreachable';
  if (!(error instanceof Refused)) return 'refused';
  if (error.status === 401) return 'signed out';
  return error.status === 408 || error.status === 429 || error.status >= 500 ? 'busy' : 'refused';
}

let probing = false;

/**
 * Marks Mild unreachable, which pauses every query where it is with what it last loaded, and asks
 * again until something answers. Coming back online resumes the paused queries and refreshes the rest.
 */
function lost() {
  onlineManager.setOnline(false);
  if (probing) return;
  probing = true;
  const ask = (wait: number) =>
    setTimeout(() => {
      fetch('/api/session', { cache: 'no-store' }).then(
        (response) => {
          if (!fromMild(response)) {
            ask(Math.min(wait * 2, 30_000));
            return;
          }
          probing = false;
          onlineManager.setOnline(true);
        },
        () => ask(Math.min(wait * 2, 30_000)),
      );
    }, wait);
  ask(2000);
}

/**
 * Mild answers every request itself, in JSON. A failure that is not (a proxy's 502 page, Vercel's
 * crashed function) is something in front of Mild saying it is not there.
 */
function fromMild(response: Response): boolean {
  return response.status < 500 || (response.headers.get('content-type') ?? '').startsWith('application/json');
}

export async function send(path: string, init: RequestInit, unreachable: string): Promise<Response> {
  let response: Response;
  const start = performance.now();
  const mine = unseen();
  try {
    response = await fetch(path, init);
    if (mine) called(init.method ?? 'GET', path, start, response.status);
  } catch (error) {
    if (mine) called(init.method ?? 'GET', path, start, null);
    if (init.signal?.aborted) throw error;
    lost();
    throw new Unreachable(unreachable, { cause: error });
  }
  if (!fromMild(response)) {
    lost();
    throw new Unreachable(unreachable);
  }
  onlineManager.setOnline(true);
  heardBuild(response.headers.get('x-sift-build'));
  return response;
}

/** The mailbox a read is narrowed to, by the signal `useLoaded` gave it, so no read has to pass it along. */
const narrowedBy = new WeakMap<AbortSignal, string>();
export const narrow = (signal: AbortSignal, mailbox: string) => void narrowedBy.set(signal, mailbox);

/**
 * Set as sign-out begins: the page is still up while it signs out and clears what it kept, and anything it read then (a
 * row read ahead of a press, as the pointer lands on it) would be refused as nobody's.
 */
let signingOut = false;
export const setSigningOut = (on: boolean) => void (signingOut = on);

export async function get<T>(path: string, params: Record<string, string | number>, signal: AbortSignal): Promise<T> {
  if (signingOut) throw new DOMException('Signing out', 'AbortError');
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== '') query.set(key, String(value));
  const mailbox = narrowedBy.get(signal);
  if (mailbox) query.set('mailbox', mailbox);
  const response = await send(`${path}?${query}`, { signal, headers: traceHeaders() }, 'Mild cannot be reached.');
  if (!response.ok) throw new Refused(response.status, await reason(response));
  return (await response.json()) as T;
}

interface Said {
  error?: string;
  missing?: string[];
}

/** What Mild said when it refused. A gateway's or a crash's page says nothing of the kind. */
export async function reason(response: Response): Promise<Said> {
  try {
    return (await response.json()) as Said;
  } catch {
    return {};
  }
}

/** Told which build Mild is, as every reply says (`x-sift-build`): `web/src/lib/build.ts` listens. */
let heardBuild: (build: string | null) => void = () => {};
export const onBuild = (heard: (build: string | null) => void) => void (heardBuild = heard);

/** Told the person's counter after each write Mild took (`x-sift-seq`): the page's copy holds the change once it has read that far (docs/sync.md). */
let wrote: (seq: number) => void = () => {};
export const onWrite = (heard: (seq: number) => void) => void (wrote = heard);

/**
 * A change. The headers mark it as coming from this page, which the server requires of every write.
 * Refused outright while Mild is unreachable: a change is never queued to happen later, unseen. Inbox's presses are, in
 * the outbox (`web/src/lib/outbox.ts`), which shows each and counts those waiting. `keepalive`: sent even as the page
 * closes, for a write held back until then.
 */
export async function post<T = unknown>(path: string, body: unknown, keepalive = false): Promise<T> {
  if (!onlineManager.isOnline()) throw new Unreachable('Mild cannot be reached, so nothing was changed. Try again when it is back.');
  const response = await send(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-sift': '1', ...traceHeaders() }, body: JSON.stringify(body), keepalive },
    'Mild stopped answering, so this may not have been saved. Check when it is back.',
  );
  const result = (await response.json()) as T & Said;
  if (!response.ok) throw new Refused(response.status, result);
  const seq = Number(response.headers.get('x-sift-seq'));
  if (seq > 0) wrote(seq);
  return result;
}
