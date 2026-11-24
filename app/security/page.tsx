import type { Metadata } from 'next';
import { SecurityView } from '@/views/legal.tsx';
import { ServiceOnly } from '@/components/service-only.tsx';

export const metadata: Metadata = { title: 'Security' };

export default function Page() {
  return (
    <ServiceOnly>
      <SecurityView />
    </ServiceOnly>
  );
}
