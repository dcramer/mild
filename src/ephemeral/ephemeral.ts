/**
 * What sift keeps only briefly and shares between every request and job: sign-ins in progress, which pass
 * holds a mailbox, Gmail quota, how the last pass went. Every key expires. Losing any of it costs a retry,
 * never part of the record, which is the database's alone (docs/RUNTIME.md).
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

interface Bucket {
  burst: number;
  perMinute: number;
}

const MINUTE_MS = 60_000;

/**
 * One process's memory. Right only while a single process uses it: `sift run` without Redis. Lost on
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
