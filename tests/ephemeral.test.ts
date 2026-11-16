import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { type Ephemeral, memoryEphemeral } from '../src/ephemeral/ephemeral.ts';
import { redisEphemeral } from '../src/ephemeral/redis.ts';

/** Set to a disposable Redis to run these against it as well (CI does). */
const REDIS = process.env['SIFT_TEST_REDIS_URL'];

const stores: [string, () => Promise<Ephemeral>][] = [['memory', async () => memoryEphemeral()]];
if (REDIS) stores.push(['redis', async () => await redisEphemeral(REDIS)]);

let open: Ephemeral[] = [];
afterEach(async () => {
  for (const store of open) await store.close();
  open = [];
});

describe.each(stores)('%s', (_name, make) => {
  const fresh = async () => {
    const store = await make();
    open.push(store);
    return store;
  };
  const key = (name: string) => `test:${name}:${crypto.randomUUID()}`;

  it('keeps a value until it expires', async () => {
    const store = await fresh();
    const k = key('value');
    await store.set(k, { a: 1 }, 50);
    expect(await store.get(k)).toEqual({ a: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));
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
    expect(await store.claim(k, 30)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await store.claim(k, 30)).not.toBeNull();
  });

  it('lets a burst through and then makes callers wait', async () => {
    const store = await fresh();
    const k = key('bucket');
    const bucket = { burst: 1_000, perMinute: 4_800 };
    expect(await store.reserve(k, 1_000, bucket)).toBe(0);
    // 12.5 ms of refill per unit; a few ms may pass between calls.
    expect(await store.reserve(k, 20, bucket)).toBeGreaterThan(200);
    expect(await store.reserve(k, 20, bucket)).toBeGreaterThan(450);
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
    const files = execFileSync('git', ['grep', '-l', '-E', `from '(redis|@redis/[^']*)'`, '--', 'src'], { encoding: 'utf8' }).trim().split('\n');
    expect(files.filter((file) => !file.startsWith('src/ephemeral/'))).toEqual([]);
  });
});
