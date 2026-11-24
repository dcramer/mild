'use client';
import { ArrowLeftIcon } from 'lucide-react';
import { ContactHint, DomainNamed } from '@/components/sender.tsx';
import type { ListedDecision, SenderPage } from '@/lib/api/endpoints.ts';
import { useCompose } from '@/lib/compose.ts';
import { count } from '@/lib/format.ts';
import { useOpenMessages } from '@/lib/open-messages.ts';
import { reveal } from '@/lib/reveal.ts';
import { Button, PageHeader } from '@/system';
import { type Who, keyOf } from './who.ts';

/** Up to the list of everyone, which this page is one of. */
export function ToContacts() {
  return (
    <Button variant="quiet" href="/contacts" className="-ml-3 self-start">
      <ArrowLeftIcon aria-hidden />
      Contacts
    </Button>
  );
}

/** Who they are, their domain and how they know each other, with a press to write to them and one to answer what is waiting. */
export function SenderHeader({
  who,
  title,
  profile,
  waiting,
}: {
  who: Who;
  title: string | null;
  profile: SenderPage['profile'];
  waiting: readonly ListedDecision[];
}) {
  const key = keyOf(who);
  const onOpen = useOpenMessages();
  const compose = useCompose();
  const items = waiting.map((r) => ({ accountId: r.accountId, messageId: r.messageId, subject: r.subject }));
  const domain = profile.domain ? reveal(profile.domain.name) : null;
  const naming = [
    ...(title ? [<span key="address">{key}</span>] : []),
    ...(domain
      ? [
          // On a phone the domain takes a line of its own, as how they know each other does below.
          <span key="domain" className="phone:basis-full">
            {title ? (
              <span aria-hidden className="mr-2 phone:hidden">
                ·
              </span>
            ) : null}
            <DomainNamed domain={domain} contact={profile.domain?.contact ?? null} />
          </span>,
        ]
      : []),
  ];
  // How they know each other takes a line of its own on a phone.
  const meta =
    naming.length > 0 || profile.contact ? (
      <>
        {naming}
        {profile.contact ? (
          <>
            {naming.length > 0 ? (
              <span aria-hidden className="phone:hidden">
                ·
              </span>
            ) : null}
            <span className="phone:basis-full">
              <ContactHint contact={profile.contact} said />
            </span>
          </>
        ) : null}
      </>
    ) : undefined;
  return (
    <div className="flex flex-col gap-3">
      <ToContacts />
      <PageHeader
        title={title ?? key}
        meta={meta}
        actions={
          (compose && 'address' in who) || waiting.length > 0 ? (
            <>
              {compose && 'address' in who ? <Button onClick={() => compose({ kind: 'new', to: who.address })}>Write to them</Button> : null}
              {waiting.length > 0 ? (
                <Button variant="mark" onClick={() => onOpen(items, 0)}>
                  Answer {count(waiting.length)} waiting
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
    </div>
  );
}
