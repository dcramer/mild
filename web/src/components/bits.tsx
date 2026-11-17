import type { DecisionRow } from '@/lib/api.ts';
import { type Status, STATUS_NAMES, outcomeName, status } from '@/lib/format.ts';
import { Does, Note, Sub } from '@/system';

/**
 * What sift says mail is and does with it, the same words everywhere: "Archive as Marketing". In a table
 * cell (`stacked`) the label goes on a quieter second line. With no label and nothing done, sift was not
 * sure, which is the reader's to answer, so it is the yellow one.
 */
export function Verdict({ labelName, disposition, stacked }: { labelName: string | null; disposition: string; stacked?: boolean }) {
  if (labelName === null && disposition === 'review') return <Does action="review">{outcomeName('review')}</Does>;
  const does = <Does action={disposition}>{outcomeName(disposition)}</Does>;
  if (stacked)
    return (
      <>
        {does}
        {labelName ? <Sub>{labelName}</Sub> : null}
      </>
    );
  return (
    <span>
      {does}
      {labelName ? <span className="text-muted-foreground"> as {labelName}</span> : null}
    </span>
  );
}

/** Where a decision has got to in Gmail, in a word. */
export function StatusWord({ row }: { row: Pick<DecisionRow, 'carryOut' | 'outcome' | 'actionStatus' | 'outcomeDetail'> }) {
  const s: Status = status(row);
  return (
    <span className="text-muted-foreground" title={row.outcomeDetail ?? undefined}>
      {STATUS_NAMES[s]}
    </span>
  );
}

/** Sift refused or failed; what was on screen stays. Sift not answering at all is the masthead's. */
export function ErrorNote({ message }: { message: string }) {
  return (
    <Note tone="failure" title="Could not refresh">
      <p>{message}</p>
    </Note>
  );
}
