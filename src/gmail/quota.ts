/**
 * Google allows each user 6,000 quota units a minute ([docs/GMAIL.md](../../docs/GMAIL.md)); past that
 * it answers 429, which a pass treats as any failure. Each mailbox draws on a bucket that holds `BURST`
 * and refills at `PER_MINUTE`, so no 60 seconds spend more than their sum. A call waits for its units
 * instead of failing. Kept in memory: a second process calling for the same mailbox has its own bucket.
 */
const BURST = 1_000;
const PER_MINUTE = 4_800;
const MINUTE_MS = 60_000;

const buckets = new Map<string, { units: number; at: number }>();

/** Counts `units` as spent for `account` and says how many milliseconds to wait before spending them. */
export function reserve(account: string, units: number, now: number): number {
  const last = buckets.get(account);
  const left = (last ? Math.min(BURST, last.units + ((now - last.at) * PER_MINUTE) / MINUTE_MS) : BURST) - units;
  buckets.set(account, { units: left, at: now });
  return left >= 0 ? 0 : Math.ceil((-left * MINUTE_MS) / PER_MINUTE);
}

export async function pace(account: string, units: number): Promise<void> {
  const wait = reserve(account, units, Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
