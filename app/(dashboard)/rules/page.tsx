import type { Metadata } from 'next';
import { Rules as RuleList } from '@/views/rules.tsx';

export const metadata: Metadata = { title: 'Rules' };

export default function Rules() {
  return <RuleList />;
}
