import type { Metadata } from 'next';
import { Blank, ListPage, Loading, Sub, Td } from '@/system';
import { LabelActions, LabelsView } from '@/views/labels.tsx';

export const metadata: Metadata = { title: 'Labels' };

export default function Labels() {
  return (
    <ListPage title="Labels" actions={<LabelActions />}>
      <LabelsView
        loading={
          <Loading>
            <Td className="max-w-0">
              <span className="name">
                <Blank />
              </span>
              <Sub>
                <Blank />
              </Sub>
            </Td>
            <Td phone="hide" className="w-48">
              <Blank />
            </Td>
            <Td phone="hide" num className="w-28">
              <Blank word />
            </Td>
          </Loading>
        }
      />
    </ListPage>
  );
}
