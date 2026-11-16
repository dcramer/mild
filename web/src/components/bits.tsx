import type { DecisionRow } from '@/lib/api.ts';
import { type Status, STATUS_NAMES, outcomeName, status, tier } from '@/lib/format.ts';
import { cn } from '@/lib/utils';
import { Code, Note, Stamp } from '@/system';

/** A tier's ink swatch and name. The name always accompanies the swatch. */
export function TierLabel({ stage }: { stage: string }) {
  const t = tier(stage);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className="size-2.5 shrink-0 rounded-[1px] ring-1 ring-foreground/20" style={{ background: t.color }} />
      {t.name}
    </span>
  );
}

/**
 * What sift says mail is and does with it, the same way everywhere: the label's name, then the action as
 * a stamp. With no label and nothing done, sift was not sure, which is the reader's to answer.
 */
export function Verdict({ labelName, disposition, unsubscribe }: { labelName: string | null; disposition: string; unsubscribe?: boolean }) {
  if (labelName === null && disposition === 'review') return <Stamp tone="look">{outcomeName('review')}</Stamp>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {labelName ? <span className="font-medium">{labelName}</span> : null}
      <Stamp>{outcomeName(disposition)}</Stamp>
      {unsubscribe ? <span className="text-muted-foreground">+ unsubscribe</span> : null}
    </span>
  );
}

/** Where a decision has got to in Gmail, in a word. A failure is the only one in red. */
export function StatusWord({ row, className }: { row: Pick<DecisionRow, 'mode' | 'outcome' | 'actionStatus' | 'outcomeDetail'>; className?: string }) {
  const s: Status = status(row);
  return (
    <span className={cn(s === 'failed' ? 'font-medium text-destructive' : 'text-muted-foreground', className)} title={row.outcomeDetail ?? undefined}>
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
