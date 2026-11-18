import { headers } from 'next/headers';
import { connection } from 'next/server';
import { type ReactNode, Suspense } from 'react';
import { Dashboard, Opening } from '@/dashboard.tsx';
import { drawnFor } from '../../src/sift/page-data.ts';

/**
 * The dashboard's frame, drawn for whoever asked, around a screen built once for everyone: going between screens needs
 * no call to the server, and opening the page is one (docs/runtime.md, "What it costs").
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Opening />}>
      <Drawn>{children}</Drawn>
    </Suspense>
  );
}

// Partial Prefetching draws each request a second time, as the prefetch it sends with the page; `connection()` keeps
// the session's three reads out of that one.
async function Drawn({ children }: { children: ReactNode }) {
  await connection();
  return <Dashboard drawn={await drawnFor(await headers())}>{children}</Dashboard>;
}
