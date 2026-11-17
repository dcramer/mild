import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { READS, WRITES } from '../src/dashboard/api/index.ts';
import type { Work } from '../src/work/run.ts';
import { MAX_DURATION_S, admit, cron, fanOut, respond, work } from '../src/vercel/host.ts';
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

  it('starts work only for a call carrying CRON_SECRET, and for none while it is unset', async () => {
    const url = 'https://sift.example.com/api/';
    const piece = JSON.stringify({ kind: 'pass', person: 1, account: 'me@example.org' });
    const post = (authorization?: string, body = piece) =>
      work(new Request(`${url}work`, { method: 'POST', body, headers: authorization ? { authorization } : {} }));
    await expect(cron(new Request(`${url}cron`))).rejects.toThrow('CRON_SECRET');
    await expect(post('Bearer ')).rejects.toThrow('CRON_SECRET');
    vi.stubEnv('CRON_SECRET', 'synthetic-secret');
    expect((await cron(new Request(`${url}cron`))).status).toBe(401);
    expect((await cron(new Request(`${url}cron`, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect((await post('Bearer synthetic-secre')).status).toBe(401);
    expect((await work(new Request(`${url}work`, { headers: { authorization: 'Bearer synthetic-secret' } }))).status).toBe(401);
    // Taken only as ids sift itself sends.
    for (const body of ['nonsense', '{"kind":"pass","person":1}', '{"kind":"pass","person":1,"account":"me@example.org","extra":1}', '{"kind":"drop"}'])
      expect((await post('Bearer synthetic-secret', body)).status).toBe(400);
  });

  it("hands each piece only to the deployment's own api/work, which takes exactly those and refuses a stranger's copy", async () => {
    vi.stubEnv('CRON_SECRET', 'synthetic-secret');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_URL', 'sift-abc123.vercel.app');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'sift.example.com');
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => (sent.push(new Request(input, init)), new Response(null, { status: 202 })));
    const pieces: Work[] = [
      { kind: 'pass', person: 1, account: 'me@example.org' },
      { kind: 'eval', person: 2, run: 7 },
    ];
    await fanOut(async () => pieces);
    expect(sent.map((request) => request.url)).toEqual(['https://sift.example.com/api/work', 'https://sift.example.com/api/work']);
    expect(await Promise.all(sent.map((request) => admit(request.clone())))).toEqual(pieces);

    // The same call without the deployment's secret, as anyone who saw its shape could make it.
    const stranger = new Request(sent[0]!.url, { method: 'POST', body: JSON.stringify(pieces[0]) });
    expect(((await admit(stranger)) as Response).status).toBe(401);
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
    expect(ownRoutes.toSorted()).toEqual(['/api/[...path]', '/api/cron', '/api/work']);
    for (const route of [...READS, ...WRITES]) expect(ownRoutes).not.toContain(route.path);
  });
});
