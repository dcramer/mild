export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

const int = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const count = (n: number) => (n >= 10_000 ? compact.format(n) : int.format(n));
/** A number only known roughly, to two figures: 1,234 is 1,200. */
export const roughly = (n: number) => count(n < 100 ? n : Number(n.toPrecision(2)));
export const percent = (part: number, whole: number) => (whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`);
export const money = (usd: number) => (usd === 0 ? '$0' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);
/** Time saved, to the minute: "40 s", "40 min", "3 h 30 min". */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}
/** Storage, to two figures: "250 MB", "3.1 GB". */
export function size(bytes: number): string {
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1000;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit++;
  }
  return `${n < 10 ? Number(n.toFixed(1)) : Math.round(n)} ${units[unit]}`;
}
/** A round amount on an axis, which may be under a cent: $0.025. */
export const moneyTick = (usd: number) => (usd === 0 ? '$0' : `$${usd >= 0.1 ? usd.toFixed(2) : Number(usd.toPrecision(2))}`);

export const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const dateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Whole days from `ms`'s day to `now`'s, in the reader's zone: 0 today, 1 yesterday. */
const daysBack = (ms: number, now: number) =>
  Math.round((new Date(new Date(now).toDateString()).getTime() - new Date(new Date(ms).toDateString()).getTime()) / 86_400_000);

/** Which part of a list of mail, newest first, `ms` falls in: a day or week back, then its month. */
export function period(ms: number, now: number): string {
  const days = daysBack(ms, now);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  if (days < 14) return 'Last week';
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

/** When mail came, under its `period`: the time of day until yesterday, then the weekday, then the date. */
export function arrived(ms: number, now: number): string {
  const days = daysBack(ms, now);
  const at = new Date(ms);
  if (days <= 1) return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return at.toLocaleDateString(undefined, { weekday: 'short' });
  return at.toLocaleDateString(
    undefined,
    at.getFullYear() === new Date(now).getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

/** When a message in a conversation came: the time today, then the day and time, the year only when it is not this one. */
export function heard(ms: number, now: number): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (daysBack(ms, now) <= 0) return time;
  if (at.getFullYear() !== new Date(now).getFullYear()) return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

export function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A day in the log: "Today", "Yesterday", else "Thu, Nov 12". */
export function dayName(ms: number, now: number = Date.now()): string {
  const start = (at: number) => {
    const d = new Date(at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const back = Math.round((start(now) - start(ms)) / 86_400_000);
  if (back === 0) return 'Today';
  if (back === 1) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
/** A time in the next few days: "today at 3:40 PM", "tomorrow at 3:40 PM", else "Thursday at 3:40 PM". */
export function ahead(ms: number, now: number): string {
  const start = (at: number) => {
    const d = new Date(at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((start(ms) - start(now)) / 86_400_000);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : new Date(ms).toLocaleDateString(undefined, { weekday: 'long' });
  return `${day} at ${clock(ms)}`;
}
export const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
