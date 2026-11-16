import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../web/src/lib/api.ts';

const answer = (status: number, body: string, type: string) => vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } }));
// A change is refused before it is sent while Sift cannot be reached.
const refusedUnsent = 'Sift cannot be reached, so nothing was changed. Try again when it is back.';

describe('the dashboard client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('takes a proxy answering for Sift as Sift not being there, until Sift answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', answer(502, '<html>Bad Gateway</html>', 'text/html'));
    await expect(api.rules(new AbortController().signal)).rejects.toThrow('Sift cannot be reached.');
    await expect(api.signOut()).rejects.toThrow(refusedUnsent);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(api.signOut()).rejects.toThrow(refusedUnsent);
    vi.stubGlobal('fetch', answer(200, '{}', 'application/json'));
    await vi.advanceTimersByTimeAsync(4000);
    await expect(api.signOut()).resolves.toEqual({});
  });

  it('leaves a failure Sift explains to the page it happened on', async () => {
    vi.stubGlobal('fetch', answer(500, '{"error":"Something broke."}', 'application/json'));
    await expect(api.rules(new AbortController().signal)).rejects.toThrow('Something broke.');
    vi.stubGlobal('fetch', answer(200, '{}', 'application/json'));
    await expect(api.signOut()).resolves.toEqual({});
  });
});
