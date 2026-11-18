import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Dashboard } from '@/dashboard.tsx';
import { drawnFor } from '../../src/app/page-data.ts';

/**
 * The dashboard's screens, in its frame, drawn for whoever asked: so each is a function call per view on Vercel
 * (docs/runtime.md, "What it costs").
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  return <Dashboard drawn={await drawnFor(await headers())}>{children}</Dashboard>;
}
