import { messageKey } from '@/lib/route.ts';
import { SenderCell, SenderCellLoading } from '@/components/sender.tsx';
import type { DecisionRow, ListedDecision } from '@/lib/api.ts';
import { INBOX, clock, dateTime, dayName, happened, status } from '@/lib/format.ts';
import { Blank, Button, Does, Loading, Marked, OnPhone, RowActions, Sub, Table, Td, Th, Tr, TrGroup } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

/**
 * What happened to a message, with the label and whether it was the user's own answer. In its own cell
 * (`stacked`) the label goes on a quieter second line.
 */
function Happened({ row, stacked, labelled }: { row: DecisionRow; stacked?: boolean; labelled?: boolean }) {
  const { text, tone } = happened(row);
  // Leave in inbox is not a kind of mail, so "Kept" says all of it.
  const label =
    row.labelName && row.labelId !== INBOX && !labelled ? (
      stacked ? (
        <Sub>{row.labelName}</Sub>
      ) : (
        <span className="text-muted-foreground"> · {row.labelName}</span>
      )
    ) : null;
  const what = (
    <>
      <Does action={row.disposition} struck={tone === 'undone'}>
        {text}
      </Does>
      {row.byUser ? <span className="text-muted-foreground/70"> · you</span> : null}
      {label}
    </>
  );
  if (tone === 'undone') return <span className="text-muted-foreground line-through">{what}</span>;
  return <span className={tone === 'quiet' ? 'text-muted-foreground' : undefined}>{what}</span>;
}

/**
 * What sift did to mail, newest first, under a heading for each day: who, the subject, what happened and
 * when. Undo where sift changed something. A row opens the message. `labelled` when every row is one label,
 * so no row names it.
 */
export function MailLog({
  rows,
  onOpen,
  onUndo,
  search,
  labelled,
}: {
  rows: ListedDecision[];
  onOpen: OpenMessages;
  onUndo: (row: DecisionRow) => void;
  search?: string;
  labelled?: boolean;
}) {
  const items = rows.map((row) => ({ accountId: row.accountId, messageId: row.messageId, subject: row.subject }));
  const term = search ? { term: search } : {};
  const days: { name: string; rows: { row: ListedDecision; index: number }[] }[] = [];
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
              <Tr key={row.id} onOpen={() => onOpen(items, index)} holds={[messageKey(row)]}>
                <SenderCell accountId={row.accountId} address={row.fromAddress} name={row.fromName} contact={row.contact} {...term}>
                  <OnPhone>
                    <span className="w-full truncate text-foreground">{row.subject || '(no subject)'}</span>
                    <Happened row={row} labelled={labelled} />
                    <span>{clock(row.decidedAt)}</span>
                  </OnPhone>
                </SenderCell>
                <Td phone="hide" className="max-w-0 md:w-full">
                  <span className="block truncate">{row.subject ? <Marked text={row.subject} {...term} /> : '(no subject)'}</span>
                </Td>
                <Td phone="hide" className="max-w-0 md:min-w-60">
                  <span className="block truncate">
                    <Happened row={row} stacked labelled={labelled} />
                  </span>
                </Td>
                <Td phone="hide" num quiet says={dateTime(row.decidedAt)}>
                  {clock(row.decidedAt)}
                </Td>
                <RowActions>
                  <span className="flex w-20 justify-end">
                    {s === 'done' && row.actionId !== null ? (
                      <Button variant="quiet" onClick={() => onUndo(row)}>
                        Undo
                      </Button>
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

/** `MailLog` while its rows are on their way. */
export function MailLogLoading() {
  return (
    <Loading rows={8}>
      <SenderCellLoading>
        <OnPhone>
          <span className="w-full">
            <Blank />
          </span>
          <Blank word />
          <Blank word />
        </OnPhone>
      </SenderCellLoading>
      <Td phone="hide" className="max-w-0 md:w-full">
        <Blank />
      </Td>
      <Td phone="hide" className="max-w-0 md:min-w-60">
        <Blank word />
        <Sub>
          <Blank word />
        </Sub>
      </Td>
      <Td phone="hide" num>
        <Blank word />
      </Td>
    </Loading>
  );
}
