import type { Metadata } from 'next';
import { LabelsView } from '@/views/labels.tsx';

export const metadata: Metadata = { title: 'Labels' };

export default function Labels() {
  return <LabelsView />;
}
