import { headers } from 'next/headers';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { Dashboard } from '@/dashboard.tsx';
import { drawnFor } from '../../src/sift/page-data.ts';

/**
 * The dashboard's frame, drawn for whoever asked, around a screen built once for everyone: going between screens needs
 * no call to the server, and opening the page is one (docs/runtime.md, "What it costs").
 *
 * It blocks rather than streaming in behind a `Suspense`: React shows a boundary's content no sooner than 300 ms after
 * the shell first paints, so a streamed frame left the page empty for that long with everything it needed already here.
 */
export const instant = false;

// Partial Prefetching draws each request a second time, as the prefetch it sends with the page; `connection()` keeps
// the session's reads out of that one.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await connection();
  return <Dashboard drawn={await drawnFor(await headers())}>{children}</Dashboard>;
}
