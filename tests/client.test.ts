import { environmentManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { api, queryClientFor, readAheadOnRest } from '../web/src/lib/api.ts';

const answer = (status: number, body: string, type: string) => vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } }));
// A change is refused before it is sent while Mild cannot be reached.
const refusedUnsent = 'Mild cannot be reached, so nothing was changed. Try again when it is back.';

describe('the dashboard client', () => {
  afterEach(() => void vi.useRealTimers());

  it('takes a proxy answering for Mild as Mild not being there, until Mild answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', answer(502, '<html>Bad Gateway</html>', 'text/html'));
    await expect(api.rules(new AbortController().signal)).rejects.toThrow('Mild cannot be reached.');
    await expect(api.saveModelKey('anthropic', 'key')).rejects.toThrow(refusedUnsent);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(api.saveModelKey('anthropic', 'key')).rejects.toThrow(refusedUnsent);
    vi.stubGlobal('fetch', answer(200, '{}', 'application/json'));
    await vi.advanceTimersByTimeAsync(4000);
    await expect(api.saveModelKey('anthropic', 'key')).resolves.toEqual({});
  });

  it('leaves a failure Mild explains to the page it happened on', async () => {
    vi.stubGlobal('fetch', answer(500, '{"error":"Something broke."}', 'application/json'));
    await expect(api.rules(new AbortController().signal)).rejects.toThrow('Something broke.');
    vi.stubGlobal('fetch', answer(200, '{}', 'application/json'));
    await expect(api.saveModelKey('anthropic', 'key')).resolves.toEqual({});
  });

  it('reads ahead only the row the pointer rests on, one at a time, and never as something waited on', async () => {
    // In the browser, where the page keeps one store of what it read; on the server each draw gets its own.
    environmentManager.setIsServer(() => false);
    onTestFinished(() => environmentManager.setIsServer(() => true));
    vi.useFakeTimers();
    const read: string[] = [];
    const stopped: string[] = [];
    const reader = (key: string) => (signal: AbortSignal) =>
      new Promise<string>((done) => {
        read.push(key);
        signal.addEventListener('abort', () => stopped.push(key));
        setTimeout(() => done(key), 1000);
      });
    // Passing over rows reads none of them.
    for (const key of ['a', 'b', 'c']) {
      readAheadOnRest(key, reader(key));
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(read).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(read).toEqual(['c']);
    expect(
      queryClientFor()
        .getQueryCache()
        .find({ queryKey: ['c'] })?.meta,
    ).toEqual({ ahead: true });
    // Resting on another before it came stops it.
    readAheadOnRest('d', reader('d'));
    await vi.advanceTimersByTimeAsync(250);
    expect(stopped).toEqual(['c']);
    expect(read).toEqual(['c', 'd']);
  });

  // Last: the page this leaves is signed out for good, as a page on its way to `/` is.
  it('asks nothing more once signing out has begun, so nothing read then is refused as nobody’s', async () => {
    const fetched = answer(200, '{}', 'application/json');
    vi.stubGlobal('fetch', fetched);
    await api.signOut();
    expect(fetched).toHaveBeenCalledTimes(1);
    await expect(api.rules(new AbortController().signal)).rejects.toThrow('Signing out');
    expect(fetched).toHaveBeenCalledTimes(1);
  });
});
