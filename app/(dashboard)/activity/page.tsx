import type { Metadata } from 'next';
import { ActivityView } from '@/views/activity.tsx';

export const metadata: Metadata = { title: 'Activity' };

export default function Activity() {
  return <ActivityView />;
}
