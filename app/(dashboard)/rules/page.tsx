import type { Metadata } from 'next';
import { Blank, ListPage, Loading, Td } from '@/system';
import { AddRule, Rules as RuleList } from '@/views/rules.tsx';

export const metadata: Metadata = { title: 'Rules' };

export default function Rules() {
  return (
    <ListPage title="Rules" actions={<AddRule />}>
      <RuleList
        loading={
          <Loading>
            <Td className="max-w-0 md:w-full">
              <Blank />
            </Td>
            <Td phone="hide" num className="md:w-28">
              <Blank word />
            </Td>
            <Td phone="hide" num className="md:w-32">
              <Blank word />
            </Td>
          </Loading>
        }
      />
    </ListPage>
  );
}
