import { globSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Ephemeral, holding, memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { redisEphemeral } from '../src/ephemeral/redis.ts';

/** Set to a disposable Redis to run these against it as well (CI does). */
const REDIS = process.env['SIFT_TEST_REDIS_URL'];

/**
 * Each store, and how time passes for it. Memory's clock is the test's, so an expiry is exact however loaded the
 * machine is; Redis keeps its own, so its tests wait for real, with room either side.
 */
interface Store {
  make: () => Promise<Ephemeral>;
  pass: (ms: number) => Promise<void>;
  /** A lifetime long enough that the calls right after setting it always land inside it. */
  ttl: number;
}
const memory = (): Store => {
  let at = 0;
  return {
    make: async () => memoryEphemeral(() => at),
    pass: async (ms) => void (at += ms),
    ttl: 50,
  };
};
const redis = (url: string): Store => ({
  make: async () => await redisEphemeral(url),
  pass: async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)),
  ttl: 1_000,
});
const stores: [string, () => Store][] = [['memory', memory]];
if (REDIS) stores.push(['redis', () => redis(REDIS)]);

let open: Ephemeral[] = [];
afterEach(async () => {
  for (const store of open) await store.close();
  open = [];
});

describe.each(stores)('%s', (name, kind) => {
  let clock = kind();
  beforeEach(() => void (clock = kind()));
  const fresh = async () => {
    const store = await clock.make();
    open.push(store);
    return store;
  };
  const key = (name: string) => `test:${name}:${crypto.randomUUID()}`;

  it('keeps a value until it expires', async () => {
    const store = await fresh();
    const k = key('value');
    await store.set(k, { a: 1 }, clock.ttl);
    expect(await store.get(k)).toEqual({ a: 1 });
    await clock.pass(clock.ttl * 1.5);
    expect(await store.get(k)).toBeNull();
  });

  it('hands a one-time value out once', async () => {
    const store = await fresh();
    const k = key('take');
    await store.set(k, 'state', 10_000);
    expect(await store.take(k)).toBe('state');
    expect(await store.take(k)).toBeNull();
  });

  it('lets one holder claim a key, and only that holder release it', async () => {
    const store = await fresh();
    const k = key('claim');
    const first = await store.claim(k, 10_000);
    expect(first).not.toBeNull();
    expect(await store.claim(k, 10_000)).toBeNull();
    await store.release(k, 'not-the-token');
    expect(await store.claim(k, 10_000)).toBeNull();
    await store.release(k, first!);
    expect(await store.claim(k, 10_000)).not.toBeNull();
  });

  it('a claim runs out by itself', async () => {
    const store = await fresh();
    const k = key('expiry');
    expect(await store.claim(k, clock.ttl)).not.toBeNull();
    expect(await store.claim(k, clock.ttl)).toBeNull();
    await clock.pass(clock.ttl * 1.5);
    expect(await store.claim(k, clock.ttl)).not.toBeNull();
  });

  it('runs work holding a key one at a time, whichever handle asks', async () => {
    const [one, two] = [await fresh(), await fresh()];
    const k = key('holding');
    const order: string[] = [];
    const work = (name: string) => async () => {
      order.push(`${name} in`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`${name} out`);
      return name;
    };
    // Two handles on one Redis stand for two instances; memory's are separate, so only one is used there.
    const other = name === 'redis' ? two : one;
    expect(await Promise.all([holding(one, k, work('a')), holding(other, k, work('b'))])).toEqual(['a', 'b']);
    expect(order).toEqual(['a in', 'a out', 'b in', 'b out']);
  });

  it('lets a burst through and then makes callers wait', async () => {
    const store = await fresh();
    const k = key('bucket');
    const bucket = { burst: 1_000, perMinute: 4_800 };
    expect(await store.reserve(k, 1_000, bucket)).toBe(0);
    // 12.5 ms of refill per unit: 250 ms for 20, then 500. Redis's clock runs on between calls, which only shortens the wait.
    expect(await store.reserve(k, 20, bucket)).toBeLessThanOrEqual(250);
    expect(await store.reserve(k, 20, bucket)).toBeGreaterThan(name === 'memory' ? 499 : 250);
  });
});

describe('memory reserve', () => {
  it('never spends more than the bucket allows in any minute', async () => {
    let at = 0;
    const store = memoryEphemeral(() => at);
    let spent = 0;
    while (at < 60_000) {
      at += await store.reserve('busy', 60, { burst: 1_000, perMinute: 4_800 });
      if (at < 60_000) spent += 60;
    }
    expect(spent).toBeLessThanOrEqual(6_000);
  });
});

describe('the Redis client', () => {
  it('is imported only by src/ephemeral', () => {
    const importing = globSync('src/**/*.ts').filter((file) => /from '(redis|@redis\/[^']*)'/.test(readFileSync(file, 'utf8')));
    expect(importing.filter((file) => !file.startsWith('src/ephemeral/'))).toEqual([]);
    expect(importing).not.toEqual([]);
  });
});
