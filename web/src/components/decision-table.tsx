import { DispositionBadge, ModelCost, Result, Sub, TD, TH, TierLabel } from '@/components/bits.tsx';
import { Marked } from '@/system';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DecisionRow } from '@/lib/api.ts';
import { ago, dateTime } from '@/lib/format.ts';

/** Decisions, newest first. Choosing a row opens that message's full history. `search` marks matching text. */
export function DecisionTable({ rows, onOpen, search }: { rows: DecisionRow[]; onOpen: (row: DecisionRow) => void; search?: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={TH}>When</TableHead>
          <TableHead className={TH}>Message</TableHead>
          <TableHead className={TH}>Outcome</TableHead>
          <TableHead className={TH}>Decided by</TableHead>
          <TableHead className={TH}>Why</TableHead>
          <TableHead className={TH}>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            tabIndex={0}
            className="cursor-pointer align-top outline-none focus-visible:bg-muted"
            onClick={() => onOpen(row)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(row);
              }
            }}
          >
            <TableCell className={`${TD} whitespace-nowrap text-muted-foreground`} title={dateTime(row.decidedAt)}>
              {ago(row.decidedAt)}
            </TableCell>
            <TableCell className={`${TD} max-w-72`}>
              <span className="block truncate font-medium">{row.subject ? <Marked text={row.subject} term={search} /> : '(no subject)'}</span>
              <Sub>
                <Marked text={row.fromName ? `${row.fromName} · ${row.fromAddress}` : row.fromAddress} term={search} />
              </Sub>
            </TableCell>
            <TableCell className={TD}>
              <DispositionBadge disposition={row.disposition} />
              {row.label ? <Sub mono>{row.label}</Sub> : null}
            </TableCell>
            <TableCell className={TD}>
              <TierLabel stage={row.stage} />
              <ModelCost row={row} />
            </TableCell>
            <TableCell className={`${TD} max-w-80 whitespace-normal text-muted-foreground`}>
              {row.reason}
              {row.confidence === null ? null : <Sub mono>confidence {row.confidence.toFixed(2)}</Sub>}
            </TableCell>
            <TableCell className={`${TD} whitespace-nowrap`}>
              <Result row={row} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
