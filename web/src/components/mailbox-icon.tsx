'use client';
import { api, useLoaded } from '@/lib/api.ts';

/** Kept by the server a month; asked again within the hour only to catch a mailbox added meanwhile. */
const ICONS_MS = 3_600_000;

/**
 * The icon of the domain of each of the person's mailboxes, for `MailboxIcon`: undefined until known, null where its
 * site has none. Null altogether for someone with one mailbox, who never needs telling which it was.
 */
export function useMailboxIcon(): ((address: string) => string | null | undefined) | null {
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const many = (manage.data?.accounts.length ?? 0) > 1;
  const icons = useLoaded(`mailbox-icons-${many}`, (signal) => (many ? api.mailboxIcons(signal) : Promise.resolve(null)), ICONS_MS, '');
  if (!many) return null;
  return (address) => (icons.data ? (icons.data.icons[address.split('@')[1] ?? ''] ?? null) : icons.error ? null : undefined);
}
