import { within } from '../telemetry.ts';
import { Refusal } from '../refusal.ts';
/**
 * What Mild keeps only briefly and shares between every request and piece of work: sign-ins in progress, which pass
 * holds a mailbox, Gmail quota, how the last pass went. Every key expires. Losing any of it costs a retry,
 * never part of the record, which is the database's alone (docs/runtime.md).
 */
export interface Ephemeral {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  /** Read and delete in one step, so a one-time value is used once. */
  take<T>(key: string): Promise<T | null>;
  /** Hold `key` for `ttlMs` unless someone does. The token releases it; null when it is held. */
  claim(key: string, ttlMs: number): Promise<string | null>;
  /** Let go of a claim, unless it has expired and someone else holds it now. */
  release(key: string, token: string): Promise<void>;
  /**
   * Count `units` against a bucket that holds `burst` and refills at `perMinute`. Returns how many
   * milliseconds to wait before spending them; they count as spent either way.
   */
  reserve(key: string, units: number, bucket: Bucket): Promise<number>;
  close(): Promise<void>;
}

/**
 * `ephemeral` with each call a span, named by the first part of its key alone (`quota`, `lock`): the rest
 * may be an address, an id or a sign-in's secret state. Reads and writes are `cache.get` and `cache.put`,
 * as Sentry's cache view reads them; holding, letting go and counting quota are Redis commands.
 */
export function tracedEphemeral(ephemeral: Ephemeral): Ephemeral {
  const kind = (key: string) => key.split(':')[0]!;
  const redis = { 'db.system.name': 'redis' };
  const read = async <T>(key: string, call: () => Promise<T | null>) =>
    await within('cache.get', kind(key), { ...redis, 'cache.key': kind(key) }, async (span) => {
      const value = await call();
      span.set({ 'cache.hit': value !== null });
      return value;
    });
  const command = <R>(operation: string, key: string, call: () => Promise<R>) =>
    within('db', `${operation} ${kind(key)}`, { ...redis, 'db.operation.name': operation }, call);
  return {
    get: (key) => read(key, () => ephemeral.get(key)),
    take: (key) => read(key, () => ephemeral.take(key)),
    set: (key, value, ttlMs) =>
      within('cache.put', kind(key), { ...redis, 'cache.key': kind(key), 'cache.ttl': Math.round(ttlMs / 1000) }, () => ephemeral.set(key, value, ttlMs)),
    claim: (key, ttlMs) => command('SET', key, () => ephemeral.claim(key, ttlMs)),
    release: (key, token) => command('EVAL', key, () => ephemeral.release(key, token)),
    reserve: (key, units, bucket) => command('EVAL', key, () => ephemeral.reserve(key, units, bucket)),
    close: () => ephemeral.close(),
  };
}

/** How long one holder may keep a key in `holding`, and how long another waits for it. */
const HOLD_MS = 60_000;

/** Run `work` while holding `key`, waiting for whoever holds it now: one at a time across every process. */
export async function holding<T>(ephemeral: Ephemeral, key: string, work: () => Promise<T>): Promise<T> {
  const giveUp = Date.now() + HOLD_MS;
  let token = await ephemeral.claim(key, HOLD_MS);
  while (token === null) {
    if (Date.now() > giveUp) throw new Refusal('Something else held this too long. Try again.');
    await new Promise((resolve) => setTimeout(resolve, 100));
    token = await ephemeral.claim(key, HOLD_MS);
  }
  try {
    return await work();
  } finally {
    await ephemeral.release(key, token);
  }
}

interface Bucket {
  burst: number;
  perMinute: number;
}

const MINUTE_MS = 60_000;

/**
 * One process's memory. Right only while a single process uses it: `mild run` without Redis. Lost on
 * restart, which the rule above allows.
 */
export function memoryEphemeral(now: () => number = Date.now): Ephemeral {
  const values = new Map<string, { value: unknown; until: number }>();
  const live = (key: string) => {
    const entry = values.get(key);
    if (entry && entry.until <= now()) values.delete(key);
    return values.get(key);
  };
  const put = (key: string, value: unknown, ttlMs: number) => {
    for (const [other, entry] of values) if (entry.until <= now()) values.delete(other);
    values.set(key, { value: structuredClone(value), until: now() + ttlMs });
  };
  return {
    get: async <T>(key: string) => (live(key)?.value ?? null) as T | null,
    set: async (key, value, ttlMs) => put(key, value, ttlMs),
    take: async <T>(key: string) => {
      const entry = live(key);
      values.delete(key);
      return (entry?.value ?? null) as T | null;
    },
    claim: async (key, ttlMs) => {
      if (live(key)) return null;
      const token = crypto.randomUUID();
      put(key, token, ttlMs);
      return token;
    },
    release: async (key, token) => {
      if (live(key)?.value === token) values.delete(key);
    },
    reserve: async (key, units, { burst, perMinute }) => {
      const at = now();
      const last = live(key)?.value as { units: number; at: number } | undefined;
      const left = (last ? Math.min(burst, last.units + ((at - last.at) * perMinute) / MINUTE_MS) : burst) - units;
      // Kept until the bucket would be full again, when it is the same as no entry.
      put(key, { units: left, at }, Math.max(1, Math.ceil(((burst - left) * MINUTE_MS) / perMinute)));
      return left >= 0 ? 0 : Math.ceil((-left * MINUTE_MS) / perMinute);
    },
    close: async () => values.clear(),
  };
}
