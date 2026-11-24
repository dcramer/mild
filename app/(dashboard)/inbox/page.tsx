import type { Metadata } from 'next';
import { ListPage } from '@/system';
import { InboxView, InboxLoading } from '@/views/inbox/index.tsx';

export const metadata: Metadata = { title: 'Inbox' };

export default function Inbox() {
  return (
    <ListPage title="Inbox">
      <InboxView loading={<InboxLoading />} />
    </ListPage>
  );
}
