import type { Metadata } from 'next';
import { PrivacyView } from '@/views/legal.tsx';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function Page() {
  return <PrivacyView />;
}
