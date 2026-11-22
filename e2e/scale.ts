#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * How long every read the page makes takes when there is a lot of mail, on verify-sift's seed at scale (`--inbox
 * --scale`: the signed-in person's messages, from about one sender in 25, and 20 other people a tenth as many each):
 *
 *   node e2e/scale.ts [--messages 5000] [--runs 5] [--root <checkout>]
 *
 * Each route is asked `runs` times one after another, after one ask that warms it, and printed slowest first by p95, as
 * the server answered it (the time to the last byte, on this machine, over PGlite). Gmail's counts (`/api/inbox`,
 * `/api/mail/reach`, `/api/rules/inbox`) are left out: they wait on Google, not on the record.
 */
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { serveSeed } from './seeded.ts';

const { values } = parseArgs({ options: { messages: { type: 'string', default: '5000' }, runs: { type: 'string', default: '5' }, root: { type: 'string' } } });
const RUNS = Number(values.runs);
const ROOT = resolve(values.root ?? join(import.meta.dirname, '..'));

const started = performance.now();
const sift = await serveSeed(ROOT, ['--inbox', '--scale', values.messages]);
process.stdout.write(`seeded ${values.messages} messages and 20 people in ${Math.round((performance.now() - started) / 1000)} s\n`);

const ask = async (path: string) => {
  const at = performance.now();
  const response = await fetch(sift.url + path, { headers: { cookie: `sift_session=${sift.cookie}` } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 200)}`);
  return { ms: performance.now() - at, body: JSON.parse(text) as unknown };
};

try {
  const { rules } = (await ask('/api/rules')).body as { rules: { id: string }[] };
  const rule = rules[0]?.id ?? '';
  // The seed's own: the heaviest sender at scale, a message and its conversation from the fixed mail.
  const READS = [
    '/api/session',
    '/api/manage',
    '/api/usage',
    '/api/suggestions',
    '/api/suggestions?kept=1',
    '/api/labels/proposal',
    '/api/summary?days=7',
    '/api/summary?days=30',
    '/api/summary?days=90',
    '/api/decisions?days=7',
    '/api/decisions?days=30',
    '/api/rules',
    `/api/rules/usage?id=${rule}`,
    `/api/rules/waiting?id=${rule}`,
    '/api/contacts',
    `/api/sender?address=${encodeURIComponent('s0@d0.example.com')}`,
    '/api/domain?domain=d0.example.com',
    '/api/message?id=m6',
    '/api/suggestion?sender=deals%40promo.example.com',
    '/api/mail/threads',
    '/api/mail/threads?view=needs',
    '/api/mail/threads?q=sender',
    '/api/mail/thread?thread=t6',
    '/api/sync',
    '/api/examples',
    '/api/evals',
    '/api/models',
  ];
  const rows: { path: string; p50: number; p95: number; max: number; bytes: number }[] = [];
  for (const path of READS) {
    const warm = await ask(path);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) times.push((await ask(path)).ms);
    const sorted = times.toSorted((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    rows.push({ path, p50: at(0.5), p95: at(0.95), max: sorted.at(-1)!, bytes: JSON.stringify(warm.body).length });
  }
  const width = Math.max(...rows.map((r) => r.path.length));
  process.stdout.write(`${'route'.padEnd(width)}    p50 ms    p95 ms    max ms    reply KB\n`);
  for (const r of rows.toSorted((a, b) => b.p95 - a.p95))
    process.stdout.write(
      `${r.path.padEnd(width)}  ${[r.p50, r.p95, r.max].map((ms) => ms.toFixed(0).padStart(8)).join('  ')}  ${(r.bytes / 1024).toFixed(1).padStart(10)}\n`,
    );
} finally {
  await sift.stop();
}
