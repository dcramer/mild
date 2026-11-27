import { useEffect, useSyncExternalStore } from 'react';
import type { Session } from './api/endpoints.ts';
import { keys } from './api/keys.ts';
import { queryClientFor } from './api/query.ts';
import { forgetDevice, keepFrame as keep, keepRead, keptFrame, readReads, unknownDevice } from './device.ts';
import { keptReads, readName } from './kept.ts';
import { idle } from './utils.ts';

/**
 * What the frame is drawn with, kept on the device for the next time the page opens (`web/src/lib/device.ts`). With it
 * For review's list and the rules Mild proposes, which Inbox draws above its rows, so a proposal does not arrive after
 * them and push every row down under the pointer.
 */
const FRAME: ReadonlySet<string> = new Set([keys.session, keys.manage, keys.usage, keys.suggestions(false, '')]);
let keeping = false;
let read = false;
const reading = new Set<() => void>();

const inFrame = (queryKey: readonly unknown[]) => queryKey.length === 1 && typeof queryKey[0] === 'string' && FRAME.has(queryKey[0]);

/**
 * Draw the frame from what this device kept, at once, and keep what Mild answers for next time: the page is one shell for
 * everyone, which the service worker serves without asking Mild, so who is signed in comes from here first and from Mild
 * after. Every other read a screen showed is kept too, read from the device once the page is idle, so a screen opened
 * again draws what it showed last time (`useLoaded`). What was kept is marked out of date, so Mild is still asked.
 * Nobody signed in, or a device Mild no longer knows, wipes what was kept; then a device is made again.
 */
function follow() {
  if (keeping || typeof window === 'undefined') return;
  keeping = true;
  const client = queryClientFor();
  void keptFrame().then(async (kept) => {
    for (const [name, value] of Object.entries(kept)) if (client.getQueryData([name]) === undefined) client.setQueryData([name], value, { updatedAt: 0 });
    read = true;
    for (const listener of reading) listener();
    // After the screen's first rows, which this would otherwise hold up.
    await idle();
    await readReads();
    // Drawn before they were read: Mild has not answered them yet.
    for (const query of client.getQueryCache().getAll()) {
      const read = keptReads.get(readName(query.queryKey));
      if (read && query.state.data === undefined) client.setQueryData(query.queryKey, read.value, { updatedAt: 0 });
    }
  });
  const signedIn = (session = client.getQueryData<Session>([keys.session])) => session !== undefined && !(session.required && session.email === null);
  client.getQueryCache().subscribe((event) => {
    const queryKey = event.query.queryKey as unknown[];
    const { data, status } = event.query.state;
    // Shown again (a message read ahead, opened), or answered while shown, unless it is what was kept.
    if (event.type === 'observerAdded' && status === 'success' && !inFrame(queryKey) && signedIn()) return void keepRead(readName(queryKey), data);
    // Only what Mild answered: the frame put back from the device (`setQueryData`, `manual`) is what was kept.
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    if (!inFrame(queryKey)) return void (event.query.getObserversCount() > 0 && signedIn() && keepRead(readName(queryKey), data));
    const name = queryKey[0] as string;
    const session = client.getQueryData<Session>([keys.session]);
    // Signed out, here or by the server: nothing more is kept, nor a key asked for that would be refused.
    if (!session || !signedIn(session)) return void (name === keys.session && forgetDevice());
    // In turn: the wipe first, then what is kept, under a key made again. What answered before the session was kept
    // under the old key and wiped with it, so all Mild has answered of the frame is kept again.
    if (name === keys.session && !session.device) {
      void unknownDevice();
      for (const kept of FRAME) {
        const state = client.getQueryState([kept]);
        if (state && state.dataUpdatedAt > 0) void keep(kept, state.data);
      }
      return;
    }
    void keep(name, data);
  });
}

export const useDeviceFrame = () => useEffect(follow, []);

/**
 * Whether the device's frame has been read, so that Mild's answer to who is signed in, which on a fast network comes
 * first, is not drawn without the rest of the frame: Settings' data a moment later would change what the screen shows.
 */
export const useFrameRead = () =>
  useSyncExternalStore(
    (listener) => {
      reading.add(listener);
      return () => void reading.delete(listener);
    },
    () => read,
    () => false,
  );
