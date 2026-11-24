import type { Ephemeral } from '../ephemeral/ephemeral.ts';
import { DAY_MS } from '../time.ts';

/** How a mailbox's last pass went, for the dashboard. Kept a week: a mailbox not passed in that long shows as never checked. */
export interface PassStatus {
  /** When it began, before it read Gmail: the gap before the next look counts from here, so a long pass does not stretch it. */
  at: number;
  error?: string;
  /** Google refused the sign-in: only signing in again helps. */
  expired?: true;
  /** Stopped at its time limit with work left, not all of it in the record. */
  unfinished?: true;
}

const KEEP_MS = 7 * DAY_MS;
const key = (mailbox: string) => `status:${mailbox}`;

export async function recordPassStatus(ephemeral: Ephemeral, mailbox: string, status: PassStatus): Promise<void> {
  await ephemeral.set(key(mailbox), status, KEEP_MS);
}

export async function lastPass(ephemeral: Ephemeral, mailbox: string): Promise<PassStatus | null> {
  return await ephemeral.get<PassStatus>(key(mailbox));
}

/** Forget a mailbox's status, when it is removed. */
export async function forgetPassStatus(ephemeral: Ephemeral, mailbox: string): Promise<void> {
  await ephemeral.take(key(mailbox));
}

/** The latest pass over these mailboxes, what went wrong on each one's last, and whose sign-in expired. */
export async function passStatus(ephemeral: Ephemeral, mailboxes: readonly string[]) {
  const each = await Promise.all(mailboxes.map(async (mailbox) => ({ mailbox, status: await ephemeral.get<PassStatus>(key(mailbox)) })));
  const at = each.flatMap(({ status }) => (status ? [status.at] : []));
  return {
    lastPassAt: at.length > 0 ? Math.max(...at) : null,
    problems: each.flatMap(({ mailbox, status }) => (status?.error ? [`${mailbox}: ${status.error}`] : [])),
    expired: each.flatMap(({ mailbox, status }) => (status?.expired ? [mailbox] : [])),
  };
}
