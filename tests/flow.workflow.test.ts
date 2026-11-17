import { describe, expect, it, vi } from 'vitest';
import { begin } from '../src/app/flow.ts';
import { runKey } from '../src/app/sift.ts';
import { offerSift } from '../src/app/process.ts';
import type { Work } from '../src/work/run.ts';

const SECRET = 'synthetic-secret';

describe('a piece of work', () => {
  it('is done by a Workflow run, one at a time for each piece', async () => {
    const done: Work[] = [];
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    offerSift(async () => ({
      work: async (piece) => {
        done.push(piece);
        await held;
        return null;
      },
    }));
    const pass: Work = { kind: 'pass', person: 1, account: 'me@example.org' };
    const other: Work = { kind: 'pass', person: 1, account: 'other@example.org' };

    expect(await begin(pass, runKey(pass, SECRET))).toBe(true);
    await vi.waitFor(() => expect(done).toEqual([pass]));
    expect(await begin(pass, runKey(pass, SECRET))).toBe(false);
    expect(await begin(other, runKey(other, SECRET))).toBe(true);
    await vi.waitFor(() => expect(done).toEqual([pass, other]));

    finish();
    await vi.waitFor(async () => expect(await begin(pass, runKey(pass, SECRET))).toBe(true));
    await vi.waitFor(() => expect(done).toEqual([pass, other, pass]));
  });

  it('is one run per inbox run, so applying a rule goes on beside going through the same inbox', async () => {
    const done: Work[] = [];
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    offerSift(async () => ({
      work: async (piece) => {
        done.push(piece);
        await held;
        return null;
      },
    }));
    const whole: Work = { kind: 'inbox', person: 1, account: 'me@example.org', run: 1 };
    const rule: Work = { ...whole, run: 2 };

    expect(await begin(whole, runKey(whole, SECRET))).toBe(true);
    expect(await begin(rule, runKey(rule, SECRET))).toBe(true);
    await vi.waitFor(() => expect(done).toHaveLength(2));
    expect(done).toEqual(expect.arrayContaining([whole, rule]));
    expect(await begin(rule, runKey(rule, SECRET))).toBe(false);

    finish();
    await vi.waitFor(async () => expect(await begin(rule, runKey(rule, SECRET))).toBe(true));
  });
});
