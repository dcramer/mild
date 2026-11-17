import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { READS, WRITES } from '../src/dashboard/api/index.ts';
import { MAX_DURATION_S, cron, respond } from '../src/vercel/host.ts';
import { tempDir } from './helpers.ts';

/** `vercel.json`: what Vercel does without sift seeing the request. */
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] };
/** Next.js's own routes under `/api/` (`app/api/`), by path. */
const ownRoutes = globSync('app/api/*/route.ts').map((file) => `/${file.replace(/^app\//, '').replace(/\/route\.ts$/, '')}`);

describe('the Vercel host', () => {
  it('ticks each minute, every route within the time limit the code assumes', () => {
    expect(vercel.crons).toEqual([{ path: '/api/cron', schedule: '* * * * *' }]);
    const routes = globSync('app/**/route.ts');
    expect(routes.length).toBeGreaterThan(0);
    for (const file of routes) expect(readFileSync(file, 'utf8'), file).toContain(`export const maxDuration = ${MAX_DURATION_S};`);
  });

  it('ticks only for a call carrying CRON_SECRET, and for none while it is unset', async () => {
    const url = 'https://sift.example.com/api/cron';
    await expect(cron(new Request(url))).rejects.toThrow('CRON_SECRET');
    vi.stubEnv('CRON_SECRET', 'synthetic-secret');
    expect((await cron(new Request(url))).status).toBe(401);
    expect((await cron(new Request(url, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    expect((await cron(new Request(url, { headers: { authorization: 'Bearer synthetic-secre' } }))).status).toBe(401);
  });

  it('until it is set up, says to whoever opens it every variable still missing, before opening anything', async () => {
    vi.stubEnv('SIFT_HOME', tempDir());
    const missing = async () => {
      const reply = await respond(new Request('https://sift.example.com/api/session'));
      expect(reply.status).toBe(503);
      return ((await reply.json()) as { missing: string[] }).missing;
    };
    const given = {
      DATABASE_URL: 'postgres://nobody@db.invalid/sift',
      REDIS_URL: 'redis://redis.invalid',
      SIFT_GOOGLE_CLIENT_ID: 'id',
      SIFT_GOOGLE_CLIENT_SECRET: 'secret',
      SIFT_SESSION_SECRET: 'synthetic',
    };
    expect(await missing()).toEqual([...Object.keys(given), 'CRON_SECRET']);
    for (const [name, value] of Object.entries(given)) vi.stubEnv(name, value);
    expect(await missing()).toEqual(['CRON_SECRET']);
  });

  it("names no dashboard route as one of Next.js's own, which would answer it instead", () => {
    expect(ownRoutes.toSorted()).toEqual(['/api/[...path]', '/api/cron']);
    for (const route of [...READS, ...WRITES]) expect(ownRoutes).not.toContain(route.path);
  });
});
