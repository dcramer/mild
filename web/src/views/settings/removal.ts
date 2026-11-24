import { type Removed } from '@/lib/api/endpoints.ts';
import { forgetHere } from '@/lib/sign-out.ts';

/** Said after a removal when Google could not be reached: Mild's access there stays until they take it away. */
const notRevoked = (reply: Removed) =>
  reply.notRevoked.length === 0
    ? null
    : `Google could not be reached, so ${reply.notRevoked.join(' and ')} still lists Mild as having access. Remove it under Third-party connections in your Google Account.`;

/** Said under what a removal deletes: Mild does not take its Gmail filters or labels with it. */
export const FILTERS_STAY =
  ' The filters Mild made in Gmail stay there, as do its labels on your mail; delete the filters in Gmail’s settings if you no longer want them.';

/** A mailbox or the account gone: off to the start when that ended the session, else what Google could not be told. */
export async function removed(sent: Promise<Removed>, onDone?: (notRevoked: string | null) => void): Promise<void> {
  const reply = await sent;
  const note = notRevoked(reply);
  // Never settles, so nothing is fetched again with the session just ended while the page leaves.
  if (reply.signedOut) {
    await forgetHere();
    return new Promise<never>(() => window.location.assign(note ? `/?signin=${encodeURIComponent(note)}` : '/'));
  }
  onDone?.(note);
}
