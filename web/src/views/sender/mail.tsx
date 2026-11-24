'use client';
import { StatusWord, Verdict } from '@/components/bits.tsx';
import { NameCell, SenderCell } from '@/components/sender.tsx';
import type { ListedDecision } from '@/lib/api/endpoints.ts';
import { dateTime, longDay, shortDay } from '@/lib/format.ts';
import type { OpenMessages } from '@/lib/open-messages.ts';
import { messageKey } from '@/lib/rows.ts';
import { reveal } from '@/lib/reveal.ts';
import { Ago, Heads, OnPhone, StackedBars, Table, Td, Th, Tr } from '@/system';

const DAY = 24 * 3_600_000;
const WEEK = 7 * DAY;

/** Their mail over time: twelve weeks, or two weeks by day for someone new. */
export function Volume({ rows, firstSeenAt, now }: { rows: ListedDecision[]; firstSeenAt: number | null; now: number }) {
  const daily = firstSeenAt !== null && now - firstSeenAt < 3 * WEEK;
  const step = daily ? DAY : WEEK;
  const length = daily ? 14 : 12;
  const start = now - length * step;
  const columns = Array.from({ length }, (_, i) => {
    const day = new Date(start + (i + 1) * step - DAY).toISOString().slice(0, 10);
    const values: Record<string, number> = {};
    return { key: day, label: shortDay(day), title: daily ? longDay(day) : `Week to ${shortDay(day)}`, values };
  });
  for (const row of rows) {
    const column = columns[Math.floor((row.receivedAt - start) / step)];
    if (column) column.values['mail'] = (column.values['mail'] ?? 0) + 1;
  }
  return <StackedBars series={[{ key: 'mail', name: 'Messages', color: 'var(--handled-changed)' }]} rows={columns} compact />;
}

/**
 * Their mail, one row per message: what it is, what Mild said, where it got to, when it came. Who sent each
 * comes first: on a domain's page the sender, as in every list of mail; for an address with several names, the name.
 */
export function Mail({ rows, onOpen, from }: { rows: ListedDecision[]; onOpen: OpenMessages; from: 'sender' | 'name' | null }) {
  const oneSender = from === null;
  const items = rows.map((r) => ({ accountId: r.accountId, messageId: r.messageId, subject: r.subject }));
  return (
    <Table>
      <Heads shown="always">
        {from === 'sender' ? <Th>Sender</Th> : from === 'name' ? <Th>From</Th> : null}
        <Th {...(oneSender ? {} : { phone: 'hide' as const })}>Message</Th>
        <Th phone="hide">Mild said</Th>
        <Th phone="hide">Status</Th>
        <Th phone="hide" num>
          Received
        </Th>
      </Heads>
      <tbody>
        {rows.map((row, index) => {
          const subject = row.subject || '(no subject)';
          const onPhone = (
            <OnPhone>
              {oneSender ? null : <span className="w-full truncate text-base text-foreground">{reveal(subject)}</span>}
              <Verdict labelId={row.labelId} labelName={row.labelName} disposition={row.disposition} />
              <span>
                <Ago at={row.receivedAt} />
              </span>
            </OnPhone>
          );
          return (
            <Tr key={row.id} onOpen={() => onOpen(items, index)} holds={[messageKey(row)]}>
              {oneSender ? (
                <Td className="max-w-0 md:w-1/2">
                  <span className="block truncate font-medium">{reveal(subject)}</span>
                  {onPhone}
                </Td>
              ) : (
                <>
                  {from === 'sender' ? (
                    <SenderCell address={reveal(row.fromAddress)} name={reveal(row.fromName)} contact={row.contact}>
                      {onPhone}
                    </SenderCell>
                  ) : (
                    <NameCell address={reveal(row.fromAddress)} name={reveal(row.fromName)}>
                      {onPhone}
                    </NameCell>
                  )}
                  <Td phone="hide" className="max-w-0 md:w-full">
                    <span className="block truncate">{reveal(subject)}</span>
                  </Td>
                </>
              )}
              <Td phone="hide" className="whitespace-nowrap">
                <Verdict labelId={row.labelId} labelName={row.labelName} disposition={row.disposition} />
              </Td>
              <Td phone="hide" className="whitespace-nowrap">
                <StatusWord row={row} />
              </Td>
              <Td phone="hide" num quiet says={dateTime(row.receivedAt)}>
                <Ago at={row.receivedAt} />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
