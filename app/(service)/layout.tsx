import type { ReactNode } from 'react';
import { ServiceOnly } from '@/components/service-only.tsx';

/** The terms, privacy policy and security page, shown only where Mild is run as a service. */
export default function ServiceLayout({ children }: { children: ReactNode }) {
  return <ServiceOnly>{children}</ServiceOnly>;
}
