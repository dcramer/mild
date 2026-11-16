import { StatusWord, Verdict } from '@/components/bits.tsx';
import { SenderLink } from '@/components/sender.tsx';
import type { DecisionRow } from '@/lib/api.ts';
import { ago, dateTime, status } from '@/lib/format.ts';
import { Button, Marked, OnPhone, RowActions, Sub, Table, Td, Th, Tr } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

/**
 * Decisions, newest first: the message, what sift said, why, where it got to, and when. Choosing a row
 * opens that message with its full history; model, cost and ids are there, not here. `search` marks
 * matching text; `onUndo` offers to undo a change that is done.
 */
export function DecisionTable({
  rows,
  onOpen,
  onUndo,
  search,
  oneSender,
}: {
  rows: DecisionRow[];
  onOpen: OpenMessages;
  onUndo?: (row: DecisionRow) => void;
  search?: string;
  /** Every row is from the same sender, named above the table, so the rows do not repeat it. */
  oneSender?: boolean;
}) {
  const items = rows.map((row) => ({ accountId: row.accountId, messageId: row.messageId, subject: row.subject }));
  const term = search ? { term: search } : {};
  return (
    <Table>
      <thead>
        <Tr>
          <Th>Message</Th>
          <Th phone="hide">sift said</Th>
          <Th phone="hide">Why</Th>
          <Th phone="hide">Status</Th>
          <Th phone="hide" num>
            When
          </Th>
          {onUndo ? <Th phone="hide" /> : null}
        </Tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <Tr key={row.id} onOpen={() => onOpen(items, index)}>
            <Td className="max-w-0 md:w-[32%]">
              <span className="block truncate font-medium">{row.subject ? <Marked text={row.subject} {...term} /> : '(no subject)'}</span>
              {oneSender ? null : (
                <Sub>
                  <SenderLink accountId={row.accountId} address={row.fromAddress}>
                    <Marked text={row.fromName ?? row.fromAddress} {...term} />
                  </SenderLink>
                </Sub>
              )}
              <OnPhone>
                <Verdict labelName={row.labelName} disposition={row.disposition} />
                <StatusWord row={row} />
                <span>{ago(row.decidedAt)}</span>
              </OnPhone>
            </Td>
            <Td phone="hide" className="whitespace-nowrap">
              <Verdict labelName={row.labelName} disposition={row.disposition} />
            </Td>
            <Td phone="hide" quiet className="max-w-0 md:w-[38%]">
              <span className="line-clamp-2" title={row.reason}>
                {row.reason}
              </span>
            </Td>
            <Td phone="hide" className="whitespace-nowrap">
              <StatusWord row={row} />
            </Td>
            <Td phone="hide" num quiet title={dateTime(row.decidedAt)}>
              {ago(row.decidedAt)}
            </Td>
            {onUndo ? (
              <RowActions>
                {status(row) === 'done' && row.actionId !== null ? (
                  <Button variant="quiet" onClick={() => onUndo(row)}>
                    Undo
                  </Button>
                ) : null}
              </RowActions>
            ) : null}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
