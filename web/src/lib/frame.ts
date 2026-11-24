import { useEffect } from 'react';
import type { Session } from './api/endpoints.ts';
import { keys } from './api/keys.ts';
import { queryClientFor } from './api/query.ts';
import { forgetDevice, keepFrame as keep, keptFrame, unknownDevice } from './device.ts';

/**
 * What the frame is drawn with, kept on the device for the next time the page opens (`web/src/lib/device.ts`). With it
 * For review's list and the rules Mild proposes, which Inbox draws above its rows, so a proposal does not arrive after
 * them and push every row down under the pointer.
 */
const FRAME: ReadonlySet<string> = new Set([keys.session, keys.manage, keys.usage, keys.suggestions(false, '')]);
let keeping = false;

/**
 * Draw the frame from what this device kept, at once, and keep what Mild answers for next time: the page is one shell for
 * everyone, which the service worker serves without asking Mild, so who is signed in comes from here first and from Mild
 * after. What was kept is marked out of date, so Mild is still asked. Nobody signed in, or a device Mild no longer
 * knows, wipes what was kept; then a device is made again.
 */
function follow() {
  if (keeping || typeof window === 'undefined') return;
  keeping = true;
  const client = queryClientFor();
  void keptFrame().then((kept) => {
    for (const [name, value] of Object.entries(kept)) if (client.getQueryData([name]) === undefined) client.setQueryData([name], value, { updatedAt: 0 });
  });
  client.getQueryCache().subscribe((event) => {
    // Only what Mild answered: the frame put back from the device (`setQueryData`, `manual`) is what was kept.
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    const [name, ...narrowed] = event.query.queryKey as unknown[];
    if (narrowed.length > 0 || typeof name !== 'string' || !FRAME.has(name)) return;
    const data = event.query.state.data;
    const session = client.getQueryData<Session>([keys.session]);
    // Signed out, here or by the server: nothing more is kept, nor a key asked for that would be refused.
    if (!session || (session.required && session.email === null)) return void (name === keys.session && forgetDevice());
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
