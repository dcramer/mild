import type { Metadata } from 'next';
import { ListPage } from '@/system';
import { ContactsView, ContactsLoading } from '@/views/contacts.tsx';

export const metadata: Metadata = { title: 'Contacts' };

export default function Contacts() {
  return (
    <ListPage title="Contacts">
      <ContactsView loading={<ContactsLoading />} />
    </ListPage>
  );
}
