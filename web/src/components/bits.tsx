import type { ReactNode } from 'react';
import type { DecisionRow } from '@/lib/api.ts';
import { ACTIONS, dispositionName, money, outcomeName, tier } from '@/lib/format.ts';
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

/** What sift did with a message; with `would`, what it would do or is set to do, in the present tense. */
export function DispositionBadge({ disposition, would }: { disposition: string; would?: boolean }) {
  const name = would ? (ACTIONS.find(([key]) => key === disposition)?.[1] ?? disposition) : dispositionName(disposition);
  return <Stamp tone={STAMP[disposition as keyof typeof STAMP] ?? 'outline'}>{name}</Stamp>;
}

/** A second line under the point of a cell. */
export function Sub({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <span className={cn('mt-0.5 block truncate text-xs text-muted-foreground', mono && 'font-mono')}>{children}</span>;
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

/** Which tier decided, and what the model cost if one was used. */
export function DecidedBy({ row }: { row: Pick<DecisionRow, 'stage' | 'model' | 'costUsd' | 'confidence'> }) {
  const facts = [
    tier(row.stage).name,
    row.model ? `${row.model} · ${money(row.costUsd)}` : null,
    row.confidence === null ? null : `confidence ${row.confidence.toFixed(2)}`,
  ];
  return <Sub>{facts.filter(Boolean).join(' · ')}</Sub>;
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

/** Something a change just did or failed to do, under the control that caused it. */
export function Outcome({ error, done }: { error?: string | null; done?: string | null }) {
  if (error) return <p className="px-(--gutter) pb-3 text-[13px] text-destructive">{error}</p>;
  return done ? <p className="px-(--gutter) pb-3 text-[13px] text-muted-foreground">{done}</p> : null;
}
