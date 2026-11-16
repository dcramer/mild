import { createClient } from 'redis';
import type { Ephemeral } from './ephemeral.ts';

/** Keys are prefixed, so one Redis can serve sift beside other things. */
const PREFIX = 'sift:';

/** Delete the key only if it still holds this token. */
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

/** The token bucket of `Ephemeral.reserve`, on Redis's clock so every instance counts alike. */
const RESERVE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local units, burst, rate = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]) / 60000
local last = redis.call('HMGET', KEYS[1], 'units', 'at')
local left = burst
if last[1] then left = math.min(burst, tonumber(last[1]) + (now - tonumber(last[2])) * rate) end
left = left - units
redis.call('HSET', KEYS[1], 'units', tostring(left), 'at', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.max(1, math.ceil((burst - left) / rate)))
if left >= 0 then return 0 end
return math.ceil(-left / rate)`;

export async function redisEphemeral(url: string): Promise<Ephemeral> {
  const client = createClient({ url });
  await client.connect();
  const parse = <T>(text: string | null) => (text === null ? null : (JSON.parse(text) as T));
  return {
    get: async (key) => parse(await client.get(PREFIX + key)),
    set: async (key, value, ttlMs) => void (await client.set(PREFIX + key, JSON.stringify(value), { expiration: { type: 'PX', value: ttlMs } })),
    take: async (key) => parse(await client.getDel(PREFIX + key)),
    claim: async (key, ttlMs) => {
      const token = crypto.randomUUID();
      const set = await client.set(PREFIX + key, JSON.stringify(token), { condition: 'NX', expiration: { type: 'PX', value: ttlMs } });
      return set === 'OK' ? token : null;
    },
    release: async (key, token) => void (await client.eval(RELEASE, { keys: [PREFIX + key], arguments: [JSON.stringify(token)] })),
    reserve: async (key, units, { burst, perMinute }) =>
      Number(await client.eval(RESERVE, { keys: [PREFIX + key], arguments: [String(units), String(burst), String(perMinute)] })),
    close: async () => {
      await client.close();
    },
  };
}
