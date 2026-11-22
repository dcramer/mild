import type { ReactNode } from 'react';
import { Dashboard } from '@/dashboard.tsx';

/**
 * A sender's and a domain's page, which have an address in their path: drawn once for everyone, as every page is, and
 * read from the address bar once started. It stands in for a page the service worker has not kept.
 */
export default function AddressedLayout({ children }: { children: ReactNode }) {
  return <Dashboard addressed>{children}</Dashboard>;
}
