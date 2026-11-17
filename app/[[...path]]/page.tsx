import { notFound } from 'next/navigation';

/**
 * Every address is the dashboard (the layout), which reads it in the browser. A name with an extension is a
 * file that is not there, except a sender's or a domain's page, which ends in an address.
 */
export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (path[0] !== 'sender' && path[0] !== 'domain' && /\.[^/]*$/.test(path.at(-1) ?? '')) notFound();
  return null;
}
