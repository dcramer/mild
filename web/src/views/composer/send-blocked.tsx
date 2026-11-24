'use client';
import type { ReactNode } from 'react';
import { useHere } from '@/lib/params.ts';
import { Button, DraftBlocked, Panel, ReplyBox } from '@/system';

/** The composer from a mailbox Google has not let Mild send from: nothing to write in, only the press that asks, and `fromLine` to send as another address. */
export function SendBlocked({
  accountId,
  title,
  fromLine,
  inline,
  about,
  onClose,
}: {
  accountId: string;
  title: string;
  fromLine: ReactNode;
  inline: boolean;
  about?: ReactNode;
  onClose: () => void;
}) {
  const here = useHere();
  const allow = (
    <Button variant="mark" href={`/auth/login?${new URLSearchParams({ grant: 'send', mailbox: accountId, to: here })}`}>
      Let Mild send
    </Button>
  );
  const blocked = <DraftBlocked title={`Mild can’t send from ${accountId} yet`}>Google asks you once before Mild can send as you.</DraftBlocked>;
  if (inline)
    return (
      <ReplyBox
        label={title}
        about={about}
        actions={
          <>
            {allow}
            <Button variant="quiet" onClick={onClose}>
              Not now
            </Button>
          </>
        }
      >
        {blocked}
      </ReplyBox>
    );
  return (
    <Panel narrow open onClose={onClose} title={title} actions={allow}>
      {fromLine}
      {blocked}
    </Panel>
  );
}
