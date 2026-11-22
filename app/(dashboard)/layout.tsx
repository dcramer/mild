import type { ReactNode } from 'react';
import { Dashboard } from '@/dashboard.tsx';

/**
 * The dashboard's frame, around a screen built once for everyone, the same for everyone too: the service worker serves
 * it without asking Mild, and the page draws the frame from what this device kept, then from Mild (docs/sync.md).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <Dashboard>{children}</Dashboard>;
}
