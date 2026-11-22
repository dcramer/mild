import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { isPublicAddress } from './public-address.ts';

/** One answer to a GET, read no further than its cap. */
interface Got {
  status: number;
  location: string | null;
  body: Buffer;
}

/** One GET to an address already checked, following nothing. Replaceable in tests. */
export type Get = (url: URL, address: string, cap: number) => Promise<Got>;

export interface IconDeps {
  resolve?: (hostname: string) => Promise<string[]>;
  get?: Get;
  now?: () => number;
}

const TIMEOUT_MS = 5000;
/** How long one domain's icon may take in all, however many pages and redirects that is: the page waits on it the first time. */
const DEADLINE_MS = 8000;
/** A homepage's head holds its icons; a page longer than this is read only this far. */
const PAGE_CAP = 256 * 1024;
/** An icon bigger than this is not an icon. */
const ICON_CAP = 100 * 1024;
const REDIRECTS = 3;
/** How many of a page's icons are tried before giving up on it. */
const TRIES = 4;
/** The size an icon is drawn at on a phone, doubled for its screen: the one closest above it is wanted. */
const WANTED_PX = 72;

const get: Get = (url, address, cap) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: { accept: 'text/html,image/*;q=0.9', 'user-agent': 'Mild (mailbox icon)' },
        timeout: TIMEOUT_MS,
        // Connect to the address that was checked, not to whatever the name resolves to a moment later.
        lookup: (_hostname, _options, callback) => callback(null, address, isIP(address)),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const done = () => resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null, body: Buffer.concat(chunks) });
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size > cap) {
            res.destroy();
            done();
          }
        });
        res.on('end', done);
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('no answer in time')));
    req.on('error', reject);
    req.end();
  });

/**
 * GET `url` as unsubscribing checks an address: plain HTTPS to a name that resolves only to the public internet,
 * connected to the address that was checked. A redirect is checked the same way before it is followed. Null for
 * anything else, and for an answer that is not 200 or longer than `cap`.
 */
async function getChecked(start: URL, cap: number, deps: IconDeps, deadline: number): Promise<{ url: URL; body: Buffer } | null> {
  let url = start;
  for (let hop = 0; hop <= REDIRECTS; hop++) {
    if ((deps.now ?? Date.now)() > deadline) return null;
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || (url.port !== '' && url.port !== '443') || isIP(url.hostname) !== 0)
      return null;
    const addresses = await (deps.resolve ?? (async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address)))(url.hostname).catch(() => []);
    const [address] = addresses;
    if (!address || !addresses.every(isPublicAddress)) return null;
    const got = await (deps.get ?? get)(url, address, cap).catch(() => null);
    if (!got) return null;
    if (got.status >= 300 && got.status < 400 && got.location) {
      try {
        url = new URL(got.location, url);
      } catch {
        return null;
      }
      continue;
    }
    return got.status === 200 && got.body.length <= cap ? { url, body: got.body } : null;
  }
  return null;
}

const ATTRIBUTE = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** The icons a page's `<link>`s name, nearest to `WANTED_PX` first, then its `/favicon.ico`. */
export function iconsOf(html: string, page: URL): URL[] {
  const found: { url: URL; px: number }[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(ATTRIBUTE)].map((m) => [m[1]!.toLowerCase(), (m[2] ?? m[3] ?? m[4] ?? '').replaceAll('&amp;', '&')]),
    );
    const rel = (attributes['rel'] ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue;
    let url: URL;
    try {
      url = new URL(attributes['href'] ?? '', page);
    } catch {
      continue;
    }
    const sizes = (attributes['sizes'] ?? '').toLowerCase();
    // A touch icon with no sizes is 180px, as browsers take it; any other with none is the 16px favicon.
    const px =
      sizes === 'any'
        ? 512
        : Math.max(0, ...sizes.split(/\s+/).map((size) => Number(size.split('x')[0]) || 0)) || (rel.includes('apple-touch-icon') ? 180 : 16);
    found.push({ url, px });
  }
  const nearness = (px: number) => (px >= WANTED_PX ? px - WANTED_PX : 10_000 - px);
  const ordered = found.toSorted((a, b) => nearness(a.px) - nearness(b.px)).map((icon) => icon.url);
  return [...ordered, new URL('/favicon.ico', page)];
}

const starts = (body: Buffer, ...bytes: number[]) => bytes.every((byte, index) => body[index] === byte);

/** What an image is, by its own first bytes, never by what its server called it; null for anything else. */
export function imageType(body: Buffer): string | null {
  if (starts(body, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(body, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (starts(body, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (body.subarray(0, 6).toString('latin1') === 'GIF87a' || body.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  // Drawn only as an image, where a browser runs none of its script.
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!doctype[^>]*>\s*)*<svg[\s>]/i.test(body.subarray(0, 2048).toString('utf8'))) return 'image/svg+xml';
  return null;
}

/**
 * The icon a domain's own site gives itself, as a `data:` address for the page to draw: from its homepage's `<link>`s,
 * else its `/favicon.ico`. Asked of the site alone, so no one else learns the domain. Null where it has none Mild can use.
 */
export async function fetchIcon(domain: string, deps: IconDeps = {}): Promise<string | null> {
  let home: URL;
  try {
    home = new URL(`https://${domain}/`);
  } catch {
    return null;
  }
  const deadline = (deps.now ?? Date.now)() + DEADLINE_MS;
  const page = await getChecked(home, PAGE_CAP, deps, deadline);
  const candidates = page ? iconsOf(page.body.toString('utf8'), page.url) : [new URL('/favicon.ico', home)];
  for (const url of candidates.slice(0, TRIES)) {
    const icon = await getChecked(url, ICON_CAP, deps, deadline);
    const type = icon ? imageType(icon.body) : null;
    if (icon && type) return `data:${type};base64,${icon.body.toString('base64')}`;
  }
  return null;
}
