import type { Metadata } from 'next';
import { SystemView } from '@/views/system/index.tsx';

export const metadata: Metadata = { title: 'System' };

/** Every part of the design system in its states. Open to anyone and holding no data, so it asks the API for nothing. */
export default function System() {
  return <SystemView />;
}
