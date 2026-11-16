import { SenderLink } from '@/components/sender.tsx';
import type { DecisionRow } from '@/lib/api.ts';
import { clock, dateTime, dayName, happened, status } from '@/lib/format.ts';
import { Button, Does, Failure, Marked, OnPhone, RowActions, Sub, Table, Td, Th, Tr, TrGroup } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

/**
 * What happened to a message, with the label and whether it was the user's own answer. In its own cell
 * (`stacked`) the label goes on a quieter second line.
 */
function Happened({ row, stacked }: { row: DecisionRow; stacked?: boolean }) {
  const { text, tone } = happened(row);
  const label = row.labelName ? stacked ? <Sub>{row.labelName}</Sub> : <span className="text-muted-foreground"> · {row.labelName}</span> : null;
  const what = (
    <>
      <Does action={row.disposition}>{text}</Does>
      {row.byUser ? <span className="text-muted-foreground/70"> · you</span> : null}
      {label}
    </>
  );
  if (tone === 'failed')
    return (
      <span title={row.outcomeDetail ?? undefined}>
        <Failure inline>{text}</Failure>
        {label}
      </span>
    );
  if (tone === 'undone') return <span className="text-muted-foreground line-through">{what}</span>;
  return <span className={tone === 'quiet' ? 'text-muted-foreground' : undefined}>{what}</span>;
}

/**
 * What sift did to mail, newest first, under a heading for each day: who, the subject, what happened and
 * when. Undo where sift changed something; Retry where a change failed. A row opens the message.
 */
export function MailLog({
  rows,
  onOpen,
  onUndo,
  onRetry,
  search,
}: {
  rows: DecisionRow[];
  onOpen: OpenMessages;
  onUndo: (row: DecisionRow) => void;
  onRetry: (row: DecisionRow) => void;
  search?: string;
}) {
  const items = rows.map((row) => ({ accountId: row.accountId, messageId: row.messageId, subject: row.subject }));
  const term = search ? { term: search } : {};
  const days: { name: string; rows: { row: DecisionRow; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const name = dayName(row.decidedAt);
    const last = days.at(-1);
    if (last?.name === name) last.rows.push({ row, index });
    else days.push({ name, rows: [{ row, index }] });
  });

  return (
    <Table keys>
      <thead className="sr-only">
        <Tr>
          <Th>Sender</Th>
          <Th phone="hide">Subject</Th>
          <Th phone="hide">What happened</Th>
          <Th phone="hide">When</Th>
          <Th phone="hide">Undo</Th>
        </Tr>
      </thead>
      {days.map((day) => (
        <tbody key={day.name}>
          <TrGroup title={day.name} span={5} />
          {day.rows.map(({ row, index }) => {
            const s = status(row);
            return (
              <Tr key={row.id} onOpen={() => onOpen(items, index)}>
                <Td className="max-w-0 md:w-[20%] md:min-w-44">
                  <span className="name block truncate">
                    <SenderLink accountId={row.accountId} address={row.fromAddress}>
                      <Marked text={row.fromName ?? row.fromAddress} {...term} />
                    </SenderLink>
                  </span>
                  <OnPhone>
                    <span className="w-full truncate text-foreground">{row.subject || '(no subject)'}</span>
                    <Happened row={row} />
                    <span>{clock(row.decidedAt)}</span>
                  </OnPhone>
                </Td>
                <Td phone="hide" quiet className="max-w-0 md:w-full">
                  <span className="block truncate">{row.subject ? <Marked text={row.subject} {...term} /> : '(no subject)'}</span>
                </Td>
                <Td phone="hide" className="max-w-0 md:min-w-60">
                  <span className="block truncate">
                    <Happened row={row} stacked />
                  </span>
                </Td>
                <Td phone="hide" num quiet title={dateTime(row.decidedAt)}>
                  {clock(row.decidedAt)}
                </Td>
                <RowActions>
                  <span className="flex w-20 justify-end">
                    {s === 'done' && row.actionId !== null ? (
                      <Button variant="quiet" onClick={() => onUndo(row)}>
                        Undo
                      </Button>
                    ) : s === 'failed' ? (
                      <Button onClick={() => onRetry(row)}>Retry</Button>
                    ) : null}
                  </span>
                </RowActions>
              </Tr>
            );
          })}
        </tbody>
      ))}
    </Table>
  );
}
