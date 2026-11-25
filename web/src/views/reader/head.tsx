'use client';
import type { ComponentProps, ReactNode } from 'react';
import { ContactHint, SenderLink } from '@/components/sender.tsx';
import type { MessageDetail } from '@/lib/api/endpoints.ts';
import { useManage } from '@/lib/api/reads.ts';
import { reveal } from '@/lib/reveal.ts';
import { MessageHead, SomeOf } from '@/system';

/** A message's head, its sender a link to their page, or "me" for the account's own. `contact` follows the name where it is known. */
export function SenderHead({
  address,
  name,
  mine,
  contact,
  ...head
}: Omit<ComponentProps<typeof MessageHead>, 'from' | 'address'> & {
  address: string;
  name: string | null;
  mine: boolean;
  contact?: MessageDetail['sender']['contact'];
}) {
  return (
    <MessageHead
      {...head}
      from={
        mine ? (
          'me'
        ) : (
          <>
            <SenderLink address={address} name={name}>
              {name ?? address}
            </SenderLink>
            {contact === undefined ? null : <ContactHint contact={contact} />}
          </>
        )
      }
      {...(name && !mine ? { address: <SenderLink address={address} /> } : {})}
    />
  );
}

/** Each address, the account's own as "me", as a mail app says it. */
const people = (list: readonly string[], account: string) => list.map((address) => (address === account ? 'me' : address));

/**
 * Who a message went to, as To and Cc rows, a long list folded. To the account alone says nothing, unless the person
 * has more than one mailbox: then To always names the one it came to, in full, first where it was not addressed. The
 * account's own mail (`mine`) came to no mailbox, and says only whom it went to.
 */
export function useAddressedTo(detail: MessageDetail): { label: 'To' | 'Cc'; who: ReactNode }[] {
  const own = detail.accountId;
  return useAddressed(
    own,
    detail.to.map((p) => reveal(p.address)),
    detail.cc.map((p) => reveal(p.address)),
    reveal(detail.fromAddress) === own,
  );
}

export function useAddressed(own: string, to: readonly string[], cc: readonly string[], mine: boolean): { label: 'To' | 'Cc'; who: ReactNode }[] {
  const manage = useManage();
  if ((manage.data?.accounts.length ?? 0) > 1) {
    const named = mine || to.includes(own) || cc.includes(own);
    return [
      { label: 'To' as const, who: <SomeOf items={named ? to : [own, ...to]} /> },
      ...(cc.length > 0 ? [{ label: 'Cc' as const, who: <SomeOf items={cc} /> }] : []),
    ];
  }
  if (cc.length === 0 && to.every((address) => address === own)) return [];
  return [
    ...(to.length > 0 ? [{ label: 'To' as const, who: <SomeOf items={people(to, own)} /> }] : []),
    ...(cc.length > 0 ? [{ label: 'Cc' as const, who: <SomeOf items={people(cc, own)} /> }] : []),
  ];
}
