import type { Metadata } from 'next';
import { ListPage } from '@/system';
import { LabelActions, LabelsView, LabelsLoading } from '@/views/labels.tsx';

export const metadata: Metadata = { title: 'Labels' };

export default function Labels() {
  return (
    <ListPage title="Labels" actions={<LabelActions />}>
      <LabelsView loading={<LabelsLoading />} />
    </ListPage>
  );
}
