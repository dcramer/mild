import type { Metadata } from 'next';
import { TermsView } from '@/views/legal.tsx';
import { ServiceOnly } from '@/components/service-only.tsx';

export const metadata: Metadata = { title: 'Terms of service' };

export default function Page() {
  return (
    <ServiceOnly>
      <TermsView />
    </ServiceOnly>
  );
}
