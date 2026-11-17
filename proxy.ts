import { type NextRequest, NextResponse } from 'next/server';
import { HEADERS, pageHeaders } from './src/dashboard/policy.ts';

/** Workflow builds a route that resumes a run waiting on a webhook. Sift creates none, so each request there only costs a lookup. */
const WEBHOOK = '/.well-known/workflow/v1/webhook/';

/** The page's policy, with a nonce of its own for each request; Next.js puts it on its scripts. */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith(WEBHOOK)) return new NextResponse(null, { status: 404, headers: HEADERS });
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const headers = pageHeaders(nonce, process.env.NODE_ENV === 'development');
  const forwarded = new Headers(request.headers);
  forwarded.set('content-security-policy', headers['content-security-policy']);
  const response = NextResponse.next({ request: { headers: forwarded } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

// The API and sign-in send their own headers, next.config.js sets those of built files, and Workflow's flow route
// is called for each step of a run, which on Vercel would be an invocation more. Any other path is the page, which
// is what Next.js draws where it has no route.
export const config = { matcher: ['/((?!api/|auth/|_next/static/|_next/image|\\.well-known/workflow/v1/flow$).*)'] };
