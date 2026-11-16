import type { DecisionRow } from '@/lib/api.ts';
import { type Status, STATUS_NAMES, outcomeName, status, tier } from '@/lib/format.ts';
import { cn } from '@/lib/utils';
import { Code, Does, Failure, Note, Swatch } from '@/system';

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
 * What sift says mail is and does with it, the same words everywhere: "Archive as Marketing". With no
 * label and nothing done, sift was not sure, which is the reader's to answer, so it is the yellow one.
 */
export function Verdict({ labelName, disposition }: { labelName: string | null; disposition: string }) {
  if (labelName === null && disposition === 'review') return <Does action="review">{outcomeName('review')}</Does>;
  return (
    <span>
      <Does action={disposition}>{outcomeName(disposition)}</Does>
      {labelName ? <span className="text-muted-foreground"> as {labelName}</span> : null}
    </span>
  );
}

/** Where a decision has got to in Gmail, in a word. A failure is the only one in red. */
export function StatusWord({ row, className }: { row: Pick<DecisionRow, 'mode' | 'outcome' | 'actionStatus' | 'outcomeDetail'>; className?: string }) {
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

/** The server could not be reached or refused; what was on screen stays. */
export function ErrorNote({ message }: { message: string }) {
  return (
    <Note tone="failure" title="Could not refresh">
      <p>
        {message} Is <Code>sift run</Code> still going?
      </p>
    </Note>
  );
}
