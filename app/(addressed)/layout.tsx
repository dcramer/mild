import type { ReactNode } from 'react';
import { Dashboard } from '@/dashboard.tsx';

/**
 * A sender's and a domain's page, which have an address in their path: drawn once for everyone, since what Next.js
 * draws for a request holds the request's path. Whose page it is the browser asks.
 */
export default function AddressedLayout({ children }: { children: ReactNode }) {
  return <Dashboard drawn={null}>{children}</Dashboard>;
}
