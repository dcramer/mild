import type { ReactNode } from 'react';
import { Dashboard } from '@/dashboard.tsx';

/** The dashboard's screens, in its frame. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <Dashboard>{children}</Dashboard>;
}
