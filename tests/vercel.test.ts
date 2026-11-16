import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { HEADERS } from '../src/dashboard/server.ts';
import { READS, WRITES } from '../src/dashboard/api/index.ts';
import { MAX_DURATION_S, cron, work } from '../src/vercel/host.ts';

/** `vercel.json`: what Vercel does without sift seeing the request. */
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  functions: Record<string, { maxDuration: number }>;
  crons: { path: string }[];
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

afterEach(() => {
  delete process.env['CRON_SECRET'];
});

describe('the Vercel host', () => {
  it("gives the page Vercel's CDN serves the dashboard's own security headers", () => {
    const all = vercel.headers.find((rule) => rule.source === '/:path*')!;
    expect(Object.fromEntries(all.headers.map((h) => [h.key, h.value]))).toEqual(HEADERS);
  });

  it('sends the API and sign-in to the function, and every other path to the page', () => {
    expect(vercel.rewrites).toEqual([
      { source: '/api/:path*', destination: '/api/site' },
      { source: '/auth/:path*', destination: '/api/site' },
      { source: '/:path*', destination: '/index.html' },
    ]);
  });

  it('ticks each minute within the time limit the code assumes', () => {
    expect(vercel.functions['api/*.ts']?.maxDuration).toBe(MAX_DURATION_S);
    expect(vercel.crons).toEqual([{ path: '/api/cron', schedule: '* * * * *' }]);
  });

  it('starts work only for a call carrying CRON_SECRET, and for none while it is unset', async () => {
    const url = 'https://sift.example.com/api/';
    const piece = JSON.stringify({ kind: 'pass', person: 1, account: 'me@example.org' });
    const post = (authorization?: string, body = piece) =>
      work(new Request(`${url}work`, { method: 'POST', body, headers: authorization ? { authorization } : {} }));
    await expect(cron(new Request(`${url}cron`))).rejects.toThrow('CRON_SECRET');
    await expect(post('Bearer ')).rejects.toThrow('CRON_SECRET');
    process.env['CRON_SECRET'] = 'synthetic-secret';
    expect((await cron(new Request(`${url}cron`))).status).toBe(401);
    expect((await cron(new Request(`${url}cron`, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect((await post('Bearer synthetic-secre')).status).toBe(401);
    expect((await work(new Request(`${url}work`, { headers: { authorization: 'Bearer synthetic-secret' } }))).status).toBe(401);
    // Taken only as ids sift itself sends.
    for (const body of ['nonsense', '{"kind":"pass","person":1}', '{"kind":"pass","person":1,"account":"me@example.org","extra":1}', '{"kind":"drop"}'])
      expect((await post('Bearer synthetic-secret', body)).status).toBe(400);
  });

  it("names no dashboard route as one of Vercel's own functions, which would answer it instead", () => {
    const functions = readdirSync('api').map((file) => `/api/${file.replace(/\.ts$/, '')}`);
    expect(functions.toSorted()).toEqual(['/api/cron', '/api/site', '/api/work']);
    for (const route of [...READS, ...WRITES]) expect(functions).not.toContain(route.path);
  });
});
