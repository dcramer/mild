import type { Ephemeral } from '../ephemeral/ephemeral.ts';

/** How a mailbox's last pass went, for the dashboard. Kept a week: a mailbox not passed in that long shows as never checked. */
interface PassStatus {
  at: number;
  error?: string;
  /** Google refused the sign-in: only signing in again helps. */
  expired?: true;
}

const KEEP_MS = 7 * 86_400_000;
const key = (mailbox: string) => `status:${mailbox}`;

export async function recordPassStatus(ephemeral: Ephemeral, mailbox: string, status: PassStatus): Promise<void> {
  await ephemeral.set(key(mailbox), status, KEEP_MS);
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
