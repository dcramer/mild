import { api } from './api/endpoints.ts';
import { clearBadge } from './badge.ts';
import { forgetDevice } from './device.ts';
import { forgetDrafts } from './compose.ts';
import { chooseMailbox } from './mailbox.ts';
import { START } from './opens-on.ts';

/** How long sign-out waits for presses still on their way. */
const SEND_MS = 5000;

/**
 * Sign out, and leave nothing of theirs in this browser for whoever uses it next (`forgetHere`).
 */
export async function signOut(): Promise<void> {
  // Before the device is wiped, and with it what waits to be sent.
  await (await import('./outbox.ts')).sendAll(SEND_MS);
  await api.signOut();
  await forgetHere();
  window.location.assign('/');
}

/**
 * Everything this browser kept of the person: what the device kept (the copy of their mail, the frame and the key; the
 * browser is told to clear it too, but not over plain HTTP), unsent drafts, the mailbox chosen, where the app opens, the count on its icon.
 * Also for a session the server ended (their mailbox or account removed), before the page leaves: the page opens on
 * the frame the device kept, which would still say they are signed in.
 */
export async function forgetHere(): Promise<void> {
  await forgetDevice();
  await clearBadge();
  forgetDrafts();
  chooseMailbox('');
  try {
    window.localStorage.removeItem(START);
  } catch {
    // Nothing was kept.
  }
}
