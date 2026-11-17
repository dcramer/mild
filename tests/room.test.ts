import { describe, expect, it } from 'vitest';
import { keptHeight } from '../web/src/lib/room.ts';

describe('keptHeight', () => {
  it('keeps 0, so a part that was empty holds no room and the list under it does not jump up', () => {
    expect(keptHeight('0')).toBe(0);
  });

  it('has nothing for a key never kept, so the usual room is held', () => {
    expect(keptHeight(null)).toBeNull();
  });

  it('ignores what is not a height', () => {
    expect(keptHeight('')).toBeNull();
    expect(keptHeight('tall')).toBeNull();
    expect(keptHeight('-4')).toBeNull();
  });

  it('keeps a height', () => {
    expect(keptHeight('206')).toBe(206);
  });
});
