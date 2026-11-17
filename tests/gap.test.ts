import { expect, it } from 'vitest';
import { lookGap } from '../src/work/gap.ts';

const MINUTE = 60_000;

it('looks every minute while mail is recent, a tenth of the quiet after that, and at most every ten minutes', () => {
  const gaps = [null, -MINUTE, 0, 5 * MINUTE, 10 * MINUTE, 20 * MINUTE, 30 * MINUTE, 60 * MINUTE, 100 * MINUTE, 24 * 60 * MINUTE].map((quiet) => [
    quiet === null ? null : quiet / MINUTE,
    lookGap(quiet) / MINUTE,
  ]);
  expect(gaps).toEqual([
    [null, 10],
    [-1, 1],
    [0, 1],
    [5, 1],
    [10, 1],
    [20, 2],
    [30, 3],
    [60, 6],
    [100, 10],
    [1440, 10],
  ]);
});
