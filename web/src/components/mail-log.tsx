import { SENDER_CELL, SenderCell, SenderCellLoading } from '@/components/sender.tsx';
import type { DecisionRow, FilterChange, ListedDecision, UnjudgedRow } from '@/lib/api.ts';
import { ago, clock, dateTime, dayName, happened, status } from '@/lib/format.ts';
import { navigate } from '@/lib/route.ts';
import { Blank, Button, Code, Does, Failure, Loading, Marked, OnPhone, RowActions, Sub, Table, Td, Th, Tr, TrGroup } from '@/system';
import { gmailMatches } from '@/views/gmail-filter.tsx';
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

/** Whether Gmail took the filter, and, when it did not, what went wrong. */
function FilterHappened({ change, stacked }: { change: FilterChange; stacked?: boolean }) {
  if (change.status === 'done') return <span>{change.type === 'filter' ? 'Added to Gmail' : 'Removed from Gmail'}</span>;
  // `unknown`: Gmail did not answer; the next check finds out whether it took.
  const word = change.status === 'failed' ? <Failure inline>Failed</Failure> : <span className="text-muted-foreground">Not confirmed</span>;
  return (
    <span title={change.error ?? undefined}>
      {word}
      {stacked && change.error ? <Sub>{change.error}</Sub> : null}
    </span>
  );
}

/** A Gmail filter sift wrote or took out. Opens its rule, while there is one. */
function FilterRow({ change }: { change: FilterChange }) {
  const { ruleId } = change;
  const matched = <Code>{gmailMatches(change.criteria)}</Code>;
  return (
    <Tr {...(ruleId ? { onOpen: () => navigate(`/rules?rule=${encodeURIComponent(ruleId)}`) } : {})}>
      <Td className={SENDER_CELL}>
        <span className="name block truncate">Gmail filter</span>
        <OnPhone>
          <span className="w-full truncate">{matched}</span>
          <FilterHappened change={change} />
          <span>{clock(change.at)}</span>
        </OnPhone>
      </Td>
      <Td phone="hide" className="max-w-0 md:w-full">
        <span className="block truncate">{matched}</span>
      </Td>
      <Td phone="hide" className="max-w-0 md:min-w-60">
        <span className="block truncate">
          <FilterHappened change={change} stacked />
        </span>
      </Td>
      <Td phone="hide" num quiet title={dateTime(change.at)}>
        {clock(change.at)}
      </Td>
      <RowActions>
        <span className="flex w-20" />
      </RowActions>
    </Tr>
  );
}

/**
 * What sift did to mail, newest first, under a heading for each day: who, the subject, what happened and
 * when. Undo where sift changed something; Retry where a change failed. A row opens the message.
 * `unjudged` goes first, under its own heading: mail the model failed on every time it was asked, with
 * Retry to put it back in the queue. `filters`, the Gmail filters sift wrote or took out, go in among the
 * rows by when.
 */
export function MailLog({
  rows,
  unjudged = [],
  filters = [],
  onOpen,
  onUndo,
  onRetry,
  onRequeue,
  search,
}: {
  rows: ListedDecision[];
  unjudged?: UnjudgedRow[];
  /** Newest first. */
  filters?: FilterChange[];
  onOpen: OpenMessages;
  onUndo: (row: DecisionRow) => void;
  onRetry: (row: DecisionRow) => void;
  onRequeue?: (row: UnjudgedRow) => void;
  search?: string;
}) {
  const items = [...unjudged, ...rows].map((row) => ({ accountId: row.accountId, messageId: row.messageId, subject: row.subject }));
  const term = search ? { term: search } : {};
  type Entry = { row: ListedDecision; index: number } | { change: FilterChange };
  const days: { name: string; rows: Entry[] }[] = [];
  const put = (at: number, entry: Entry) => {
    const name = dayName(at);
    const last = days.at(-1);
    if (last?.name === name) last.rows.push(entry);
    else days.push({ name, rows: [entry] });
  };
  let next = 0;
  rows.forEach((row, index) => {
    for (; next < filters.length && filters[next].at > row.decidedAt; next++) put(filters[next].at, { change: filters[next] });
    put(row.decidedAt, { row, index: unjudged.length + index });
  });
  for (const change of filters.slice(next)) put(change.at, { change });

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
                <SenderCell accountId={row.accountId} address={row.fromAddress} name={row.fromName} {...term}>
                  <OnPhone>
                    <span className="w-full truncate text-foreground">{row.subject || '(no subject)'}</span>
                    {failed}
                    <span>{ago(row.triedAt)}</span>
                  </OnPhone>
                </SenderCell>
                <Td phone="hide" className="max-w-0 md:w-full">
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
          {day.rows.map((entry) => {
            if ('change' in entry) return <FilterRow key={`filter-${entry.change.id}`} change={entry.change} />;
            const { row, index } = entry;
            const s = status(row);
            return (
              <Tr key={row.id} onOpen={() => onOpen(items, index)}>
                <SenderCell accountId={row.accountId} address={row.fromAddress} name={row.fromName} contact={row.contact} {...term}>
                  <OnPhone>
                    <span className="w-full truncate text-foreground">{row.subject || '(no subject)'}</span>
                    <Happened row={row} />
                    <span>{clock(row.decidedAt)}</span>
                  </OnPhone>
                </SenderCell>
                <Td phone="hide" className="max-w-0 md:w-full">
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
