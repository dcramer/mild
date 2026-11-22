'use client';
import { api, useLoaded } from '@/lib/api.ts';
import { type Writing, useCompose } from '@/lib/compose.ts';
import { reveal } from '@/lib/reveal.ts';
import { dateTime } from '@/lib/format.ts';
import { Arrived, Empty, Heads, Loading, Table, Td, Th, Tr } from '@/system';
import type { SavedDraft } from '../../../src/dashboard/types.ts';

/** What opens a draft in the composer: a new message by its name, a reply or forward by the message it answers. */
function writingOf(draft: SavedDraft): Writing {
  const of = reveal(draft.writing.of);
  return of.kind === 'new' ? { kind: 'new', draft: draft.id } : of;
}

/**
 * Inbox's Drafts: mail begun and not sent, from any device, newest first, as Mild keeps it (Gmail's Drafts have each a few
 * minutes after it was last changed). Pressed, a draft opens in the composer where it was left.
 */
export function DraftList({ mailbox }: { mailbox: string }) {
  const saved = useLoaded('drafts', (signal) => api.drafts(signal), 60_000, '');
  const compose = useCompose();
  if (!saved.data) return <Loading rows={3} />;
  const drafts = saved.data.drafts.filter((d) => !mailbox || d.accountId === mailbox).toReversed();
  if (drafts.length === 0) return <Empty>No drafts.</Empty>;
  return (
    <Table dense>
      <Heads>
        <Th>To</Th>
        <Th phone="hide">Subject</Th>
        <Th phone="hide">Saved</Th>
      </Heads>
      <tbody>
        {drafts.map((draft) => {
          const writing = reveal(draft.writing);
          const to = [...writing.to, ...writing.cc, ...writing.bcc].map((r) => r.name ?? r.address).join(', ');
          const subject = writing.subject.trim() || (writing.of.kind === 'new' ? '(no subject)' : writing.of.kind === 'reply' ? 'Reply' : 'Forward');
          const text = writing.text.trim().replaceAll(/\s+/g, ' ');
          return (
            <Tr key={draft.id} onOpen={() => compose?.(writingOf(draft))}>
              <Td className="max-w-0 md:w-[18%] md:min-w-40">
                <span className="block truncate">{to || <span className="text-muted-foreground">No one yet</span>}</span>
                <span className="block truncate text-muted-foreground md:hidden">{subject}</span>
              </Td>
              <Td phone="hide" className="max-w-0 md:w-full">
                <span className="block truncate">
                  {subject}
                  {text ? <span className="text-muted-foreground"> — {text}</span> : null}
                </span>
              </Td>
              <Td phone="hide" className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">
                {draft.sendAt ? `Sends ${dateTime(draft.sendAt)}` : <Arrived at={draft.changedAt} />}
                {draft.sendError ? <span className="block">Not sent as scheduled</span> : null}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
