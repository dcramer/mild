import { api } from './api.ts';
import { forgetDrafts } from './compose.ts';
import { chooseMailbox } from './mailbox.ts';
import { START } from './start.ts';

/**
 * Sign out, and leave nothing of theirs in this browser for whoever uses it next: the copy of their mail (whose key the
 * server deletes, and which the browser is told to clear, but not over plain HTTP), unsent drafts, the mailbox chosen, where the app opens.
 */
export async function signOut(): Promise<void> {
  await api.signOut();
  await (await import('./copy.ts')).dropCopy();
  forgetDrafts();
  chooseMailbox('');
  try {
    window.localStorage.removeItem(START);
  } catch {
    // Nothing was kept.
  }
  window.location.assign('/');
}
