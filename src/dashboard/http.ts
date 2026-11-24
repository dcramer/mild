import type { z } from 'zod';
import { FRAME_POLICY, IMAGES_FRAME_POLICY, NOSNIFF } from './policy.ts';

/** A message's own HTML, in a frame on the page (`FRAMES`). A link it opens, or an image it shows, learns nothing of where it was opened from. */
export const frameHeaders = (images: boolean) => ({
  'content-security-policy': images ? IMAGES_FRAME_POLICY : FRAME_POLICY,
  ...NOSNIFF,
  'referrer-policy': 'no-referrer',
  // A link's host would otherwise be looked up ahead of a click, which tells its DNS the message was opened.
  'x-dns-prefetch-control': 'off',
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
});

const MEDIA_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

/**
 * A file from the person's mail (`DOWNLOADS`), whose name and type its sender chose: always saved, never shown at this
 * address, where an HTML or SVG file would run as the page, and with no origin of its own if a browser shows it anyway.
 * The name twice, as a quoted ASCII stand-in and in RFC 6266's encoding, which keeps every character.
 */
export const fileHeaders = (name: string, type: string) => {
  // No control character, which could end the header.
  const clean = name
    .split('')
    .filter((c) => c >= ' ' && c !== '\u007f')
    .join('');
  const ascii = clean.replaceAll(/[^\x20-\x7e]/g, '_').replaceAll(/["\\]/g, '\\$&');
  const encoded = encodeURIComponent(clean).replaceAll(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    'content-type': MEDIA_TYPE.test(type) ? type : 'application/octet-stream',
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    'content-security-policy': "default-src 'none'; sandbox",
    ...NOSNIFF,
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  };
};

/** Streamed, since Vercel answers at most 4.5 MB in one body that is not, and a file may be 25 MB. */
const STREAM_PIECE = 256 * 1024;
export const streamed = (data: Buffer) => {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(stream) {
      if (at >= data.length) return stream.close();
      stream.enqueue(data.subarray(at, (at += STREAM_PIECE)));
    },
  });
};

// Data, fetched by the page: a policy or a referrer policy would govern nothing.
export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...NOSNIFF, 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

export const redirect = (location: string, ...cookies: string[]) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
};

/**
 * What was wrong with a request, for whoever sent it: the first field refused and why. It names the
 * field, never its value.
 */
export const refusedBy = (error: z.ZodError) => {
  const issue = error.issues[0];
  const field = issue?.path.join('.');
  return field ? `${field}: ${issue?.message}` : (issue?.message ?? 'That request is not well formed.');
};

/**
 * A reply that does not match its route's schema is Mild's own mistake: it is not sent, since what it
 * would send is not what the page was promised.
 */
export const replied = (schema: z.ZodType, body: unknown): { status: number; body: unknown } => {
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { status: 200, body: parsed.data }
    : { status: 500, body: { error: `The reply did not match its schema (${refusedBy(parsed.error)}).` } };
};

/** Read a JSON body of at most `largest` characters. Null if it is longer or not a JSON object. */
export async function readJson(request: Request, largest: number): Promise<Record<string, unknown> | null> {
  let body = '';
  if (request.body) {
    const decoder = new TextDecoder();
    for await (const chunk of request.body) {
      body += decoder.decode(chunk, { stream: true });
      if (body.length > largest) return null;
    }
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const cookie = (request: Request, name: string) =>
  (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];
