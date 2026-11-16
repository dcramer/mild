import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { HEADERS } from '../src/dashboard/server.ts';
import { MAX_DURATION_S, cron } from '../src/vercel/host.ts';

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

  it("starts a tick only for Vercel's cron", async () => {
    process.env['CRON_SECRET'] = 'synthetic-secret';
    expect((await cron(new Request('https://sift.example.com/api/cron'))).status).toBe(401);
    expect((await cron(new Request('https://sift.example.com/api/cron', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
  });
});
