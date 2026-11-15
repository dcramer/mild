import { DecidedBy, DispositionBadge, Result, Sub } from '@/components/bits.tsx';
import type { DecisionRow } from '@/lib/api.ts';
import { ago, dateTime } from '@/lib/format.ts';
import { Marked, Table, Td, Th, Tr } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

/** Decisions, newest first. Choosing a row opens that message's full history. `search` marks matching text. */
export function DecisionTable({ rows, onOpen, search }: { rows: DecisionRow[]; onOpen: OpenMessages; search?: string }) {
  const items = rows.map((row) => ({ accountId: row.accountId, messageId: row.messageId, subject: row.subject }));
  return (
    <Table>
      <thead>
        <Tr>
          <Th>Message</Th>
          <Th>Outcome</Th>
          <Th>Why</Th>
          <Th>Result</Th>
          <Th className="text-right">When</Th>
        </Tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <Tr key={row.id} onOpen={() => onOpen(items, index)}>
            <Td className="max-w-72">
              <span className="block truncate font-medium">
                {row.subject ? <Marked text={row.subject} {...(search ? { term: search } : {})} /> : '(no subject)'}
              </span>
              <Sub>
                <Marked text={row.fromName ? `${row.fromName} · ${row.fromAddress}` : row.fromAddress} {...(search ? { term: search } : {})} />
              </Sub>
            </Td>
            <Td className="whitespace-nowrap">
              <DispositionBadge disposition={row.disposition} />
              {row.labelName ? <Sub>{row.labelName}</Sub> : null}
            </Td>
            <Td className="max-w-96">
              {row.reason}
              <DecidedBy row={row} />
            </Td>
            <Td className="whitespace-nowrap">
              <Result row={row} />
            </Td>
            <Td quiet className="text-right whitespace-nowrap" title={dateTime(row.decidedAt)}>
              {ago(row.decidedAt)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
