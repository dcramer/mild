import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import type { GmailApi } from '../gmail/api.ts';
import { reportError } from '../telemetry.ts';

const MINUTE = 60_000;
/** Google suggests making a watch again each day. One lasts 7 days, so days missed lose nothing. */
const WATCHED_MS = 24 * 60 * MINUTE;
/** After Gmail refused a watch, which a topic it may not publish to does, how long before it is asked again. */
const REFUSED_MS = 60 * MINUTE;
/** A push not yet looked at: longer than any gap, so the look it waits for comes first. */
const PUSHED_MS = 30 * MINUTE;
/** Gmail pushes up to one change a second. One look in this long takes in the rest, and the tick after looks at what came since. */
const LOOKED_MS = 10_000;

const watchKey = (account: string) => `watch:${account}`;
const pushKey = (account: string) => `pushed:${account}`;

/** Watch the mailbox, unless a watch was made today or refused within the hour. A failure leaves the mailbox to the look. */
export async function keepWatching(
  api: Pick<GmailApi, 'watch'>,
  account: string,
  topic: string,
  ephemeral: Ephemeral,
  log: (line: string) => void,
): Promise<void> {
  if ((await ephemeral.get(watchKey(account))) !== null) return;
  try {
    await api.watch(topic);
    await ephemeral.set(watchKey(account), true, WATCHED_MS);
  } catch (error) {
    reportError(error);
    log(`${account}: Gmail would not push its changes to ${topic}: ${error instanceof Error ? error.message : String(error)}`);
    await ephemeral.set(watchKey(account), false, REFUSED_MS);
  }
}

/** Whether Gmail is pushing the mailbox's changes, as far as Sift knows. */
export const watched = async (ephemeral: Ephemeral, account: string) => (await ephemeral.get(watchKey(account))) === true;

/**
 * A push from Gmail for the mailbox: its next look reads history whatever its gap. True when this push is the one to look
 * now; the rest within `LOOKED_MS` wait for the tick.
 */
export async function pushed(ephemeral: Ephemeral, account: string): Promise<boolean> {
  await markPush(ephemeral, account);
  return (await ephemeral.claim(`looked:${account}`, LOOKED_MS)) !== null;
}

const markPush = (ephemeral: Ephemeral, account: string) => ephemeral.set(pushKey(account), true, PUSHED_MS);

/**
 * Whether a push came since the mailbox's last look or pass, which this one answers. A look that wants a pass gives it back
 * (`keepPush`), since that pass may be refused while another runs.
 */
export const takePush = async (ephemeral: Ephemeral, account: string) => (await ephemeral.take(pushKey(account))) !== null;

/** A push a look found wanted a pass for, kept until a pass begins reading Gmail. */
export const keepPush = markPush;
