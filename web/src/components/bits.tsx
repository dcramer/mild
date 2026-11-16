import type { DecisionRow } from '@/lib/api.ts';
import { type Status, STATUS_NAMES, outcomeName, status, tier } from '@/lib/format.ts';
import { cn } from '@/lib/utils';
import { Does, Failure, Note, Sub, Swatch } from '@/system';

/** A tier's ink swatch and name. The name always accompanies the swatch. */
export function TierLabel({ stage }: { stage: string }) {
  const t = tier(stage);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <Swatch color={t.color} />
      {t.name}
    </span>
  );
}

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

/** Where a decision has got to in Gmail, in a word. A failure is the only one in red. */
export function StatusWord({ row, className }: { row: Pick<DecisionRow, 'carryOut' | 'outcome' | 'actionStatus' | 'outcomeDetail'>; className?: string }) {
  const s: Status = status(row);
  if (s === 'failed')
    return (
      <Failure inline className={className} title={row.outcomeDetail ?? undefined}>
        {STATUS_NAMES[s]}
      </Failure>
    );
  return (
    <span className={cn('text-muted-foreground', className)} title={row.outcomeDetail ?? undefined}>
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
