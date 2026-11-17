import { type NextRequest, NextResponse } from 'next/server';
import { pageHeaders } from './src/dashboard/policy.ts';

/** The page's policy, with a nonce of its own for each request; Next.js puts it on its scripts. */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const headers = pageHeaders(nonce, process.env.NODE_ENV === 'development');
  const forwarded = new Headers(request.headers);
  forwarded.set('content-security-policy', headers['content-security-policy']);
  const response = NextResponse.next({ request: { headers: forwarded } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

// The API and sign-in send their own headers; built files and Workflow's routes need none.
export const config = { matcher: ['/((?!api/|auth/|_next/static/|_next/image|\\.well-known/workflow/).*)'] };
