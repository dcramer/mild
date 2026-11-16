import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import {
  type DeviceCode,
  type PendingRedirect,
  finishChatGPTRedirect,
  pollChatGPTDeviceCode,
  startChatGPTDeviceCode,
  startChatGPTRedirect,
} from '../model/models.ts';
import type { SignIns } from '../model/credentials.ts';

/** A ChatGPT sign-in waiting on a person, or how their last one failed. Kept briefly, where every request and job can read it. */
type Waiting = { device: DeviceCode } | { redirect: PendingRedirect } | { error: string };

const key = (person: number) => `signin:chatgpt:${person}`;
/** A failure is shown until they start again, or this long. */
const ERROR_MS = 10 * 60_000;

/** What the page shows of a person's ChatGPT sign-in in progress. */
export async function chatgptPending(ephemeral: Ephemeral, person: number, now = Date.now()) {
  const waiting = await ephemeral.get<Waiting>(key(person));
  if (!waiting) return null;
  if ('error' in waiting) return { error: waiting.error };
  const { expiresAt, url } = 'device' in waiting ? waiting.device : waiting.redirect;
  if (expiresAt < now) return { error: 'device' in waiting ? 'That code expired. Start again.' : 'That sign-in expired. Start again.' };
  return 'device' in waiting ? { code: waiting.device.code, url, expiresAt } : { url, expiresAt };
}

/** Start a sign-in the install's way. A device code is then checked by `checkChatGPT`, starting after the interval it returns. */
export async function startChatGPT(ephemeral: Ephemeral, person: number, how: 'device-code' | 'redirect', deviceId: string) {
  if (how === 'redirect') {
    const redirect = await startChatGPTRedirect(deviceId);
    await ephemeral.set(key(person), { redirect } satisfies Waiting, redirect.expiresAt - Date.now());
    return { shown: { url: redirect.url, expiresAt: redirect.expiresAt }, checkIn: null };
  }
  const device = await startChatGPTDeviceCode();
  await ephemeral.set(key(person), { device } satisfies Waiting, device.expiresAt - Date.now());
  return { shown: { code: device.code, url: device.url, expiresAt: device.expiresAt }, checkIn: device.intervalMs };
}

export async function finishChatGPT(ephemeral: Ephemeral, person: number, signIns: SignIns, address: string): Promise<void> {
  const waiting = await ephemeral.get<Waiting>(key(person));
  if (!waiting || !('redirect' in waiting)) throw new Error('No ChatGPT sign-in is waiting. Start again.');
  await finishChatGPTRedirect(signIns, waiting.redirect, address);
  await ephemeral.take(key(person));
}

/**
 * Ask OpenAI once whether the person has entered their device code. Returns how long to wait before asking
 * again, `done` when they are signed in, or null when there is nothing to ask about (or it failed, which
 * the page then shows).
 */
export async function checkChatGPT(ephemeral: Ephemeral, person: number, signIns: SignIns): Promise<number | 'done' | null> {
  const waiting = await ephemeral.get<Waiting>(key(person));
  if (!waiting || !('device' in waiting)) return null;
  try {
    const answer = await pollChatGPTDeviceCode(signIns, waiting.device);
    if (answer === 'done') {
      await ephemeral.take(key(person));
      return 'done';
    }
    // OpenAI's way of asking for five more seconds between questions.
    if (answer === 'slow down') waiting.device.intervalMs += 5000;
    await ephemeral.set(key(person), waiting, waiting.device.expiresAt - Date.now());
    return waiting.device.intervalMs;
  } catch (error) {
    await ephemeral.set(key(person), { error: error instanceof Error ? error.message : String(error) } satisfies Waiting, ERROR_MS);
    return null;
  }
}

export async function forgetChatGPT(ephemeral: Ephemeral, person: number): Promise<void> {
  await ephemeral.take(key(person));
}
