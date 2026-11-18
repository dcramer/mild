import { describe, expect, it, vi } from 'vitest';
import { getWorld } from 'workflow/runtime';
import { begin } from '../src/sift/flow.ts';
import { runKey } from '../src/sift/sift.ts';
import { offerSift } from '../src/sift/instance.ts';
import type { Work } from '../src/work/run.ts';

describe('a piece of work', () => {
  it('is done by a Workflow run, one at a time for each piece', async () => {
    const done: Work[] = [];
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    offerSift({
      work: async (piece) => {
        done.push(piece);
        await held;
        return null;
      },
    });
    const pass: Work = { kind: 'pass', person: 1, mailbox: 1 };
    const other: Work = { kind: 'pass', person: 1, mailbox: 2 };

    const before = Date.now();
    expect(await begin(pass, runKey(pass))).toEqual({ begun: true });
    await vi.waitFor(() => expect(done).toEqual([pass]));
    const refused = await begin(pass, runKey(pass));
    expect(refused.begun).toBe(false);
    // When the run holding the key began, so a run that never ends shows (src/sift/sift.ts).
    expect(!refused.begun && refused.since).toBeGreaterThanOrEqual(before - 1000);
    expect(await begin(other, runKey(other))).toEqual({ begun: true });
    await vi.waitFor(() => expect(done).toEqual([pass, other]));

    finish();
    await vi.waitFor(async () => expect(await begin(pass, runKey(pass))).toEqual({ begun: true }));
    await vi.waitFor(() => expect(done).toEqual([pass, other, pass]));
  });

  it('is one run per inbox run, so applying a rule goes on beside going through the same inbox', async () => {
    const done: Work[] = [];
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    offerSift({
      work: async (piece) => {
        done.push(piece);
        await held;
        return null;
      },
    });
    const whole: Work = { kind: 'inbox', person: 1, mailbox: 1, run: 1 };
    const rule: Work = { ...whole, run: 2 };

    expect(await begin(whole, runKey(whole))).toEqual({ begun: true });
    expect(await begin(rule, runKey(rule))).toEqual({ begun: true });
    await vi.waitFor(() => expect(done).toHaveLength(2));
    expect(done).toEqual(expect.arrayContaining([whole, rule]));
    expect((await begin(rule, runKey(rule))).begun).toBe(false);

    finish();
    await vi.waitFor(async () => expect(await begin(rule, runKey(rule))).toEqual({ begun: true }));
  });

  it('leaves nothing of itself behind once done: its input names the mailbox', async () => {
    offerSift({ work: async () => null });
    const since = new Date();
    const pass: Work = { kind: 'pass', person: 1, mailbox: 3 };
    const key = runKey(pass);
    expect(await begin(pass, key)).toEqual({ begun: true });
    await vi.waitFor(async () => expect(await begin(pass, key)).toEqual({ begun: true }));
    const world = await getWorld();
    await vi.waitFor(async () => {
      const { data } = await world.runs.list({ resolveData: 'all' });
      // The data directory is shared with other test files, and keeps runs from before.
      const ended = data.filter((run) => run.status === 'completed' && run.createdAt >= since);
      expect(ended.length).toBeGreaterThan(0);
      expect(ended.map((run) => run.input)).toEqual(ended.map(() => undefined));
    });
  });

  it('is listed by what it does, with the ids it was for', async () => {
    offerSift({ work: async () => null });
    const since = new Date();
    const pieces: Work[] = [
      { kind: 'pass', person: 2, mailbox: 5 },
      { kind: 'inbox', person: 2, mailbox: 5, run: 7 },
      { kind: 'eval', person: 2, run: 8 },
      { kind: 'upkeep', person: 2 },
    ];
    for (const piece of pieces) expect(await begin(piece, runKey(piece))).toEqual({ begun: true });
    const world = await getWorld();
    await vi.waitFor(async () => {
      const { data } = await world.runs.list();
      const ended = data.filter((run) => run.status === 'completed' && run.createdAt >= since);
      expect(new Set(ended.map((run) => `${run.workflowName.split('//').pop()} ${JSON.stringify(run.attributes)}`))).toEqual(
        new Set([
          'mailboxPass {"kind":"pass","person":"2","mailbox":"5","$retention":"0"}',
          'inboxRun {"kind":"inbox","person":"2","mailbox":"5","run":"7","$retention":"0"}',
          'testRun {"kind":"eval","person":"2","run":"8","$retention":"0"}',
          'upkeep {"kind":"upkeep","person":"2","$retention":"0"}',
        ]),
      );
    });
  });
});
