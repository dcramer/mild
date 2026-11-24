import type { Metadata } from 'next';
import { ListPage } from '@/system';
import { AddRule, Rules as RuleList, RulesLoading } from '@/views/rules.tsx';

export const metadata: Metadata = { title: 'Rules' };

export default function Rules() {
  return (
    <ListPage title="Rules" actions={<AddRule />}>
      <RuleList loading={<RulesLoading />} />
    </ListPage>
  );
}
