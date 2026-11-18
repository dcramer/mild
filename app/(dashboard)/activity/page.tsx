import type { Metadata } from 'next';
import { MailLogLoading } from '@/components/mail-log.tsx';
import { ListPage } from '@/system';
import { ActivityPeriod, ActivityView } from '@/views/activity.tsx';

export const metadata: Metadata = { title: 'Activity' };

export default function Activity() {
  return (
    <ListPage title="Activity" actions={<ActivityPeriod />}>
      <ActivityView loading={<MailLogLoading />} />
    </ListPage>
  );
}
