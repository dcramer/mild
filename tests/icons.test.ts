import { describe, expect, it } from 'vitest';
import { type Get, fetchIcon, iconsOf, imageType } from '../src/icons.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 1, 0, 16, 16]);
const page = (head: string) => Buffer.from(`<!doctype html><html><head>${head}</head><body>Hello</body></html>`);

/** A site of fixed answers by address, every name resolving to `addresses`, with each GET it was asked written down. */
function site(answers: Record<string, { status?: number; location?: string; body?: Buffer }>, addresses = ['203.0.113.7']) {
  const asked: string[] = [];
  const get: Get = async (url, _address, cap) => {
    asked.push(url.href);
    const answer = answers[url.href] ?? { status: 404 };
    return { status: answer.status ?? 200, location: answer.location ?? null, body: (answer.body ?? Buffer.alloc(0)).subarray(0, cap + 1) };
  };
  return { asked, deps: { resolve: async () => addresses, get } };
}

describe('fetchIcon', () => {
  it('takes the icon the homepage names nearest the size it is drawn at, from where a redirect led', async () => {
    const { deps, asked } = site({
      'https://example.org/': { status: 301, location: '/welcome' },
      'https://example.org/welcome': {
        body: page('<link rel="icon" href="/small.png" sizes="16x16"><link rel="apple-touch-icon" href="touch.png?v=1&amp;x=2">'),
      },
      'https://example.org/touch.png?v=1&x=2': { body: PNG },
    });
    expect(await fetchIcon('example.org', deps)).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(asked).toEqual(['https://example.org/', 'https://example.org/welcome', 'https://example.org/touch.png?v=1&x=2']);
  });

  it('falls back to /favicon.ico, and takes an image only by its own bytes', async () => {
    const { deps } = site({
      'https://example.org/': { body: page('<link rel="shortcut icon" href="/not-an-image.png">') },
      'https://example.org/not-an-image.png': { body: Buffer.from('<html>Not found</html>') },
      'https://example.org/favicon.ico': { body: ICO },
    });
    expect(await fetchIcon('example.org', deps)).toBe(`data:image/x-icon;base64,${ICO.toString('base64')}`);
  });

  it('asks for /favicon.ico when the homepage does not answer', async () => {
    const { deps } = site({ 'https://example.org/': { status: 500 }, 'https://example.org/favicon.ico': { body: ICO } });
    expect(await fetchIcon('example.org', deps)).toMatch(/^data:image\/x-icon;base64,/);
  });

  it('asks nothing of a name that does not lead to the public internet', async () => {
    for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '::1']) {
      const { deps, asked } = site({ 'https://example.org/favicon.ico': { body: ICO } }, [address]);
      expect(await fetchIcon('example.org', deps), address).toBeNull();
      expect(asked, address).toEqual([]);
    }
  });

  it('follows no redirect off plain HTTPS, nor more than three', async () => {
    const plain = site({
      'https://example.org/': { status: 302, location: 'http://example.org/' },
      'https://example.org/favicon.ico': { status: 302, location: 'https://user:pw@example.org/icon.png' },
    });
    expect(await fetchIcon('example.org', plain.deps)).toBeNull();
    expect(plain.asked).toEqual(['https://example.org/', 'https://example.org/favicon.ico']);
    const looping = site({
      'https://example.org/': { status: 302, location: '/' },
      'https://example.org/favicon.ico': { status: 302, location: '/favicon.ico' },
    });
    expect(await fetchIcon('example.org', looping.deps)).toBeNull();
    expect(looping.asked).toHaveLength(8);
  });

  it('takes a malformed redirect as no icon, and gives up on a site once its time is spent', async () => {
    const broken = site({
      'https://example.org/': { status: 302, location: 'https://[bad' },
      'https://example.org/favicon.ico': { status: 302, location: 'http://[' },
    });
    expect(await fetchIcon('example.org', broken.deps)).toBeNull();

    let now = 0;
    const slow = site({ 'https://example.org/': { body: page('<link rel="icon" href="/a.png"><link rel="icon" href="/b.png">') } });
    const get = slow.deps.get;
    const icon = await fetchIcon('example.org', {
      ...slow.deps,
      now: () => now,
      get: async (url, address, cap) => ((now += 5000), await get(url, address, cap)),
    });
    expect(icon).toBeNull();
    expect(slow.asked).toEqual(['https://example.org/', 'https://example.org/a.png']);
  });

  it('refuses an icon too big to be one', async () => {
    const { deps } = site({ 'https://example.org/favicon.ico': { body: Buffer.concat([ICO, Buffer.alloc(200 * 1024)]) } });
    expect(await fetchIcon('example.org', deps)).toBeNull();
  });
});

describe('iconsOf', () => {
  it('orders what a page names by how near it is to the size wanted, the favicon last', () => {
    const icons = iconsOf(
      '<link rel="icon" href="/16.png" sizes="16x16"><link rel="icon" href="/32.png" sizes="32x32"><link rel="icon" href="/192.png" sizes="192x192"><link href="/96.png" rel="icon" sizes="96x96"><link rel="mask-icon" href="/mask.svg"><link rel="stylesheet" href="/a.css">',
      new URL('https://example.org/a/'),
    );
    expect(icons.map((url) => url.pathname)).toEqual(['/96.png', '/192.png', '/32.png', '/16.png', '/favicon.ico']);
  });
});

describe('imageType', () => {
  it('names what the bytes are, never what the server said', () => {
    expect(imageType(PNG)).toBe('image/png');
    expect(imageType(ICO)).toBe('image/x-icon');
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageType(Buffer.from('GIF89a...'))).toBe('image/gif');
    expect(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(imageType(Buffer.from('<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(imageType(Buffer.from('<!doctype html><html><svg></svg></html>'))).toBeNull();
    expect(imageType(Buffer.from('plain text'))).toBeNull();
  });
});
