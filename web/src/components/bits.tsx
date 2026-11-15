import type { ReactNode } from 'react';
import type { DecisionRow } from '@/lib/api.ts';
import { dispositionName, money, outcomeName, tier } from '@/lib/format.ts';
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

const STAMP = { review: 'look', spam: 'ink', archive: 'tint' } as const;

/** What sift did with a message. */
export function DispositionBadge({ disposition }: { disposition: string }) {
  return <Stamp tone={STAMP[disposition as keyof typeof STAMP] ?? 'outline'}>{dispositionName(disposition)}</Stamp>;
}

export function Sub({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <span className={cn('block truncate text-xs text-muted-foreground', mono && 'font-mono')}>{children}</span>;
}

/** What became of a decision in the mailbox. */
export function Result({ row }: { row: Pick<DecisionRow, 'actionId' | 'actionType' | 'actionStatus' | 'outcome' | 'outcomeDetail'> }) {
  if (row.actionId !== null) {
    const bad = row.actionStatus !== 'done' && row.actionStatus !== 'undone';
    return (
      <span className={bad ? 'font-medium text-destructive' : undefined}>
        {row.actionType} {row.actionStatus}
        <Sub mono>#{row.actionId}</Sub>
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      {outcomeName(row.outcome)}
      {row.outcomeDetail ? <Sub>{row.outcomeDetail}</Sub> : null}
    </span>
  );
}

export function ModelCost({ row }: { row: Pick<DecisionRow, 'model' | 'costUsd'> }) {
  return row.model ? (
    <Sub mono>
      {row.model} · {money(row.costUsd)}
    </Sub>
  ) : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <Note tone="failure" title="Could not refresh" className="bg-card">
      <p>
        {message} Is <Code>sift run</Code> still going?
      </p>
    </Note>
  );
}

/** Table header and cell classes shared by every table, so they line up with the panel's 16px gutter. */
export const TH = 'slug h-9 px-4 text-muted-foreground';
export const TD = 'px-4 py-2.5';
export const NUM = 'text-right tabular-nums';
