import type { Metadata } from 'next';
import { PrivacyView } from '@/views/legal.tsx';
import { ServiceOnly } from '@/views/service-only.tsx';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function Page() {
  return (
    <ServiceOnly>
      <PrivacyView />
    </ServiceOnly>
  );
}
