import { describe, expect, it } from 'vitest';
import { reserve } from '../src/gmail/quota.ts';

describe('reserve', () => {
  it('lets a burst through, then makes calls wait for the bucket to refill', () => {
    expect(reserve('burst@example.org', 1_000, 0)).toBe(0);
    expect(reserve('burst@example.org', 20, 0)).toBe(250);
    expect(reserve('burst@example.org', 20, 0)).toBe(500);
    expect(reserve('burst@example.org', 20, 60_000)).toBe(0);
  });

  it('never spends more than Google allows in any minute', () => {
    let spent = 0;
    let at = 0;
    // Back-to-back full reads, each made when its wait is over.
    while (at < 60_000) {
      at += reserve('busy@example.org', 60, at);
      if (at < 60_000) spent += 60;
    }
    expect(spent).toBeLessThanOrEqual(6_000);
  });

  it('keeps each mailbox to its own share', () => {
    expect(reserve('one@example.org', 1_000, 0)).toBe(0);
    expect(reserve('two@example.org', 1_000, 0)).toBe(0);
  });
});
