'use client';
import type { MessageDetail } from '@/lib/api/endpoints.ts';
import { count } from '@/lib/format.ts';
import { useOpenMessages } from '@/lib/open-messages.ts';
import { reveal } from '@/lib/reveal.ts';
import { SenderCell } from '@/components/sender.tsx';
import { Arrived, Empty, Heads, OnPhone, Section, Sub, Table, Td, Th, Tr } from '@/system';

type Digest = NonNullable<MessageDetail['digest']>;
type Listed = Digest['mail'][number];

/**
 * One of Mild's digests, drawn in place of the message Mild wrote: what the model thought worth a look, with why, then
 * the rest of the label's mail Mild archived, each opening in the reader. Read from the record, so what was answered
 * for or put back since has left it.
 */
export function DigestBody({ digest }: { digest: Digest }) {
  const open = useOpenMessages();
  const why = new Map(digest.picks.map((p) => [p.messageId, p.why]));
  const picked = digest.mail.filter((m) => why.has(m.messageId));
  const rest = digest.mail.filter((m) => !why.has(m.messageId));
  // In the order drawn, so J and K in the reader go through them as they are listed.
  const listed = [...picked, ...rest];
  const refs = listed.map((m) => ({ accountId: m.accountId, messageId: m.messageId, subject: m.subject }));
  const rows = (mail: readonly Listed[]) => (
    <Table dense>
      <Heads>
        <Th>From</Th>
        <Th>Subject</Th>
        <Th num>Received</Th>
      </Heads>
      <tbody>
        {mail.map((m) => {
          const because = why.get(m.messageId);
          return (
            <Tr key={`${m.accountId}/${m.messageId}`} onOpen={() => open(refs, listed.indexOf(m))}>
              {/* On a phone as For review's rows: who and when, then the subject and why under them. */}
              <SenderCell
                address={reveal(m.from.address)}
                name={m.from.name ? reveal(m.from.name) : null}
                line
                aside={
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums md:hidden">
                    <Arrived at={m.receivedAt} />
                  </span>
                }
              >
                <OnPhone>
                  <span className="w-full truncate text-base text-foreground">{reveal(m.subject) || '(no subject)'}</span>
                  {because ? <span className="w-full truncate">{reveal(because)}</span> : null}
                </OnPhone>
              </SenderCell>
              <Td phone="hide" className="max-w-0 md:w-full">
                <span className="block truncate">{reveal(m.subject) || '(no subject)'}</span>
                {because ? <Sub className="truncate">{reveal(because)}</Sub> : null}
              </Td>
              <Td phone="hide" num quiet>
                <Arrived at={m.receivedAt} />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
  if (listed.length === 0) return <Empty>Everything it listed has since been answered or put back in the inbox.</Empty>;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {picked.length > 0 ? (
        <Section title="Worth a look" meta={count(picked.length)}>
          {rows(picked)}
        </Section>
      ) : null}
      <Section title={`Archived as ${digest.labelName}`} meta={count(rest.length)}>
        {rest.length > 0 ? rows(rest) : <Empty>Mild picked all of it.</Empty>}
      </Section>
    </div>
  );
}
