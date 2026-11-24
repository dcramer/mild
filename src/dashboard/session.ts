import { createHmac, timingSafeEqual } from 'node:crypto';
import { DAY_MS } from '../time.ts';

export const SESSION_DAYS = 30;
/** A browser's key outlives any one session: the copy it encrypts is kept across sign-ins until one signs out. 400 days is the most a browser keeps a cookie. */
export const DEVICE_DAYS = 400;
/** A device's id, as the server makes it. */
export const DEVICE_ID = /^[0-9a-f]{32}$/;
/** A session in use is issued again once this old, so someone who opens Mild within the month is never signed out. */
export const RENEW_MS = DAY_MS;
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A session cookie value: which mailbox, whose, until when, signed so it cannot be forged or altered. */
export function signSession(session: { email: string; person: number }, secret: string, now: number): string {
  const body = b64(JSON.stringify({ e: session.email, p: session.person, x: now + SESSION_DAYS * DAY_MS }));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** The mailbox and person a session cookie was issued to, and when it ends, or null if it is missing, forged or expired. */
export function readSession(value: string | undefined, secret: string, now: number): { email: string; person: number; expires: number } | null {
  const [body, signature] = (value ?? '').split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { e, p, x } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { e?: unknown; p?: unknown; x?: unknown };
    return typeof e === 'string' && typeof p === 'number' && typeof x === 'number' && x > now ? { email: e, person: p, expires: x } : null;
  } catch {
    return null;
  }
}

/** The cookies a browser holds for Mild, `Secure` where it was reached over HTTPS. */
export const cookies = (https: boolean) => {
  const set = (name: string, path: string) => (value: string, maxAge: number) =>
    `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`;
  return {
    session: set('sift_session', '/'),
    // The sign-in under way in this browser. Google's return carries the state; only the browser that
    // started the sign-in also holds it here, so a consent link sent to someone else completes nothing.
    signIn: set('sift_signin', '/auth'),
    device: set('sift_device', '/'),
  };
};
