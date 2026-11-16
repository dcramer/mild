import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { and, eq, messages } from '../store/query.ts';
import type { Sql } from '../store/sql.ts';
import { finishAction, insertPendingAction, lastUnsubscribeFailure, unsubscribedAt } from '../store/actions.ts';
import { bulkSignals, passedDmarc } from '../triage/features.ts';

export type UnsubscribeOutcome =
  /** The sender's server accepted the request. */
  | { status: 'done'; actionId: number }
  /** Nothing was attempted, and why. */
  | { status: 'refused'; reason: string }
  /** The request was made and did not succeed, or its result is not known. */
  | { status: 'failed'; actionId: number; reason: string };

/** Sends the one-click request. Resolves with the HTTP status. Replaceable in tests. */
export type PostOneClick = (url: URL, address: string) => Promise<number>;

export interface UnsubscribeDeps {
  db: Sql;
  now?: () => number;
  /** Resolve a hostname to its addresses. */
  resolve?: (hostname: string) => Promise<string[]>;
  post?: PostOneClick;
}

/** True for an address on the public internet: not loopback, private, link-local, shared, multicast or reserved. */
export function isPublicAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    if (mapped) return isPublicAddress(mapped);
    // Loopback and unspecified, unique local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8).
    return !(lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff'));
  }
  return false;
}

const TIMEOUT_MS = 10_000;
export const RETRY_AFTER_MS = 7 * 86_400_000;

/** RFC 8058: one POST with a fixed body, to the address already checked, following nothing. */
const postOneClick: PostOneClick = (url, address) =>
  new Promise((resolve, reject) => {
    const body = 'List-Unsubscribe=One-Click';
    const req = request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) },
        timeout: TIMEOUT_MS,
        // Connect to the address that was checked, not to whatever the name resolves to a moment later.
        lookup: (_hostname, _options, callback) => callback(null, address, isIP(address)),
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () => req.destroy(new Error("the sender's server did not answer in time")));
    req.on('error', reject);
    req.end(body);
  });

/**
 * Unsubscribe from the list a message came from, the one way sift can do it safely: the sender's own
 * one-click address (RFC 8058), and only where the user's label or rule says to.
 *
 * The address comes from the email, so nothing about it is trusted. It is used only if the message
 * passed DMARC (so the header is the real sender's), is HTTPS on the standard port with no credentials,
 * and resolves to a public address (so it cannot be pointed at this machine or its network). One POST
 * is made; a redirect is not followed. Lists that can only be left by sending an email are refused:
 * sift does not send mail. Recorded as an action before the request, never repeated for a sender it
 * worked for, and not retried for a week for one it failed for.
 */
export async function unsubscribe(deps: UnsubscribeDeps, accountId: string, messageId: string): Promise<UnsubscribeOutcome> {
  const now = deps.now ?? Date.now;
  const [message] = await deps.db
    .select({ fromAddress: messages.fromAddress, headers: messages.headers })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.id, messageId)));
  if (!message) return { status: 'refused', reason: 'There is no such message.' };
  const signals = bulkSignals(message.headers);
  if (!signals.oneClickUnsubscribeUrl) {
    return {
      status: 'refused',
      reason: signals.hasListUnsubscribe
        ? 'This list can only be left by sending an email or opening a page, and sift does neither. Use the link in the message.'
        : 'This message offers no way to unsubscribe.',
    };
  }
  if (!passedDmarc(message.headers)) return { status: 'refused', reason: 'The message did not prove who sent it, so its unsubscribe address is not trusted.' };
  if ((await unsubscribedAt(deps.db, accountId, message.fromAddress)) !== null)
    return { status: 'refused', reason: 'You have already unsubscribed from this sender.' };
  // sift runs this for every message a label says to unsubscribe from: a sender whose address fails is left alone for a while.
  const failed = await lastUnsubscribeFailure(deps.db, accountId, message.fromAddress);
  if (failed !== null && now() - failed < RETRY_AFTER_MS)
    return { status: 'refused', reason: 'Unsubscribing from this sender failed recently; it will be tried again later.' };

  let url: URL;
  try {
    url = new URL(signals.oneClickUnsubscribeUrl);
  } catch {
    return { status: 'refused', reason: 'The unsubscribe address in the message is not a valid address.' };
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || (url.port !== '' && url.port !== '443') || isIP(url.hostname) !== 0)
    return { status: 'refused', reason: 'The unsubscribe address is not a plain HTTPS address, so it is not used.' };

  let addresses: string[];
  try {
    addresses = await (deps.resolve ?? (async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address)))(url.hostname);
  } catch {
    return { status: 'refused', reason: `The unsubscribe address (${url.hostname}) could not be found.` };
  }
  const [address] = addresses;
  if (!address || !addresses.every(isPublicAddress))
    return { status: 'refused', reason: `The unsubscribe address (${url.hostname}) does not lead to the public internet, so it is not used.` };

  // The host is recorded, not the whole address: the rest of it is a token that identifies the subscriber.
  const actionId = await insertPendingAction(
    deps.db,
    { accountId, messageId, type: 'unsubscribe', payload: { add: [], remove: [], unsubscribe: url.hostname }, originalLabels: [] },
    now(),
  );
  let reason: string;
  try {
    const status = await (deps.post ?? postOneClick)(url, address);
    if (status >= 200 && status < 300) {
      await finishAction(deps.db, actionId, 'done', null, null, now());
      return { status: 'done', actionId };
    }
    reason =
      status >= 300 && status < 400
        ? `${url.hostname} answered with a redirect, which sift does not follow.`
        : `${url.hostname} refused the request (${status}).`;
  } catch (error) {
    reason = `The request to ${url.hostname} failed, so it is not known whether it took: ${error instanceof Error ? error.message : String(error)}.`;
  }
  await finishAction(deps.db, actionId, 'failed', null, reason, now());
  return { status: 'failed', actionId, reason };
}
