import { ContactHint, SenderLink } from '@/components/sender.tsx';
import type { DecisionRow, ListedDecision, UnjudgedRow } from '@/lib/api.ts';
import { ago, clock, dateTime, dayName, happened, status } from '@/lib/format.ts';
import { Blank, Button, Does, Failure, Loading, Marked, OnPhone, RowActions, Sub, Table, Td, Th, Tr, TrGroup } from '@/system';
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
 * `unjudged` goes first, under its own heading: mail the model failed on every time it was asked, with
 * Retry to put it back in the queue.
 */
export function MailLog({
  rows,
  unjudged = [],
  onOpen,
  onUndo,
  onRetry,
  onRequeue,
  search,
}: {
  rows: ListedDecision[];
  unjudged?: UnjudgedRow[];
  onOpen: OpenMessages;
  onUndo: (row: DecisionRow) => void;
  onRetry: (row: DecisionRow) => void;
  onRequeue?: (row: UnjudgedRow) => void;
  search?: string;
}) {
  const items = [...unjudged, ...rows].map((row) => ({ accountId: row.accountId, messageId: row.messageId, subject: row.subject }));
  const term = search ? { term: search } : {};
  const days: { name: string; rows: { row: ListedDecision; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const name = dayName(row.decidedAt);
    const last = days.at(-1);
    if (last?.name === name) last.rows.push({ row, index: unjudged.length + index });
    else days.push({ name, rows: [{ row, index: unjudged.length + index }] });
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
      {unjudged.length > 0 ? (
        <tbody>
          <TrGroup title="Not judged" span={5} />
          {unjudged.map((row, index) => {
            const failed = (
              <span title={row.error ?? undefined}>
                <Failure inline>Model failed</Failure>
              </span>
            );
            return (
              <Tr key={`${row.accountId}/${row.messageId}`} onOpen={() => onOpen(items, index)}>
                <Td className="max-w-0 md:w-[20%] md:min-w-44">
                  <span className="name block truncate">
                    <SenderLink accountId={row.accountId} address={row.fromAddress}>
                      <Marked text={row.fromName ?? row.fromAddress} {...term} />
                    </SenderLink>
                  </span>
                  <OnPhone>
                    <span className="w-full truncate text-foreground">{row.subject || '(no subject)'}</span>
                    {failed}
                    <span>{ago(row.triedAt)}</span>
                  </OnPhone>
                </Td>
                <Td phone="hide" quiet className="max-w-0 md:w-full">
                  <span className="block truncate">{row.subject ? <Marked text={row.subject} {...term} /> : '(no subject)'}</span>
                </Td>
                <Td phone="hide" className="max-w-0 md:min-w-60">
                  <span className="block truncate">
                    {failed}
                    {row.error ? <Sub>{row.error}</Sub> : null}
                  </span>
                </Td>
                <Td phone="hide" num quiet title={dateTime(row.triedAt)}>
                  {ago(row.triedAt)}
                </Td>
                <RowActions>
                  <span className="flex w-20 justify-end">{onRequeue ? <Button onClick={() => onRequeue(row)}>Retry</Button> : null}</span>
                </RowActions>
              </Tr>
            );
          })}
        </tbody>
      ) : null}
      {days.map((day) => (
        <tbody key={day.name}>
          <TrGroup title={day.name} span={5} />
          {day.rows.map(({ row, index }) => {
            const s = status(row);
            return (
              <Tr key={row.id} onOpen={() => onOpen(items, index)}>
                <Td className="max-w-0 md:w-[20%] md:min-w-44">
                  <span className="flex items-center gap-2">
                    <span className="name min-w-0 truncate">
                      <SenderLink accountId={row.accountId} address={row.fromAddress}>
                        <Marked text={row.fromName ?? row.fromAddress} {...term} />
                      </SenderLink>
                    </span>
                    <ContactHint contact={row.contact} />
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

/** `MailLog` while its rows are on their way. */
export function MailLogLoading() {
  return (
    <Loading rows={8}>
      <Td className="max-w-0 md:w-[20%] md:min-w-44">
        <span className="name">
          <Blank />
        </span>
        <OnPhone>
          <span className="w-full">
            <Blank />
          </span>
          <Blank word />
          <Blank word />
        </OnPhone>
      </Td>
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
