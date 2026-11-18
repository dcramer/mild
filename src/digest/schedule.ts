const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** How far `zone`'s clock is ahead of UTC at `at`, in milliseconds. */
function offset(at: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  const { year = 0, month = 1, day, hour, minute } = parts;
  const local = Date.UTC(year, month - 1, day, hour, minute);
  return local - (at - (at % 60_000));
}

/** The moment `zone`'s clocks read `wall` (a local time written as if it were UTC): the first, if twice; when they skip it, the skip. */
function instantOf(wall: number, zone: string): number {
  const candidates = [...new Set([offset(wall - DAY_MS, zone), offset(wall + DAY_MS, zone)])].map((o) => wall - o);
  const read = candidates.filter((at) => at + offset(at, zone) === wall);
  return read.length > 0 ? Math.min(...read) : Math.max(...candidates);
}

/** The latest moment at or before `at` that `zone`'s clocks read `hour`:00. */
export function scheduledBefore(at: number, hour: number, zone: string): number {
  const shifted = at + offset(at, zone);
  const today = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) + hour * HOUR_MS;
  const moment = instantOf(today, zone);
  return moment <= at ? moment : instantOf(today - DAY_MS, zone);
}

/** Whether `zone` is a time zone this runtime knows. */
export function knownZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}
