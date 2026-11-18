import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { getWorld } from 'workflow/runtime';
import { begin } from '../src/app/flow.ts';
import { offerSift } from '../src/app/process.ts';
import { runKey } from '../src/app/sift.ts';
import type { Work } from '../src/work/run.ts';

/** Where `@workflow/vitest` builds and keeps its runs (`rootDir`, vitest.config.ts). */
const CACHE = resolve('node_modules/.cache/workflow-vitest');

/**
 * Sift starting again on the same runs, as `sift run` does: a new World on the data directory, delivering to the
 * build's flow route, with a Sift whose step finishes at once. A worker, since the World treats a step as cut off
 * only when it started before the World was loaded in the process. Says whether `key` was let go.
 */
const startAgain = (key: string) =>
  new Promise<string>((done, fail) => {
    const worker = new Worker(
      `
      const { workerData, parentPort } = require('node:worker_threads');
      const { createRequire } = require('node:module');
      const { pathToFileURL } = require('node:url');
      const { setTimeout: sleep } = require('node:timers/promises');
      const load = (path) => import(pathToFileURL(path).href);
      (async () => {
        const fromVitest = createRequire(workerData.vitest);
        const { createWorld } = await load(fromVitest.resolve('@workflow/world-local'));
        const { setWorld } = await load(fromVitest.resolve('@workflow/core/runtime'));
        const { POST } = await load(workerData.flow);
        globalThis[Symbol.for('sift.sift')] = async () => ({ work: async () => null });
        const world = createWorld({ dataDir: workerData.dataDir, tag: workerData.tag });
        world.registerHandler('__wkf_workflow_', POST);
        setWorld(world);
        await (await load(workerData.host)).takeUpRuns();
        let outcome = 'held';
        for (let tries = 0; tries < 100 && outcome === 'held'; tries++) {
          outcome = await world.hooks.getByToken(workerData.key).then(() => 'held', () => 'let go');
          if (outcome === 'held') await sleep(100);
        }
        await world.close();
        parentPort.postMessage(outcome);
      })().catch((error) => parentPort.postMessage(String(error)));
      `,
      {
        eval: true,
        workerData: {
          vitest: join(realpathSync('node_modules/@workflow/vitest'), 'package.json'),
          flow: join(CACHE, '.workflow-vitest/combined.mjs'),
          host: resolve('src/cli/host.ts'),
          dataDir: join(CACHE, '.workflow-data'),
          tag: `vitest-${process.env['VITEST_POOL_ID'] ?? '0'}`,
          key,
        },
      },
    );
    worker.once('message', (outcome: string) => void worker.terminate().then(() => done(outcome)));
    worker.once('error', fail);
  });

it('a run cut off while its step ran is taken up when Sift starts again, and lets go of its key', async () => {
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  offerSift(async () => ({
    work: async () => {
      started();
      return await new Promise<never>(() => {});
    },
  }));
  // Its own mailbox: keys are shared by every test file on the data directory.
  const pass: Work = { kind: 'pass', person: 1, mailbox: 4 };
  const key = runKey(pass);
  expect(await begin(pass, key)).toEqual({ begun: true });
  await running;
  // The process stops with the step under way: the World's queue, held only in memory, goes with it.
  await (await getWorld()).close?.();
  expect(await startAgain(key)).toBe('let go');
});
