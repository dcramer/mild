import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import type { DecisionRow } from '@/lib/api.ts';
import { dispositionName, money, outcomeName, tier } from '@/lib/format.ts';
import { cn } from '@/lib/utils';

/** A stroke of highlighter. Used sparingly: for the number that matters and for what needs the reader. */
export function Highlight({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('hl', className)}>{children}</span>;
}

/** `text` with every occurrence of `term` highlighted, as a search result would be marked by hand. */
export function Marked({ text, term }: { text: string; term?: string }) {
  const needle = term?.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: ReactNode[] = [];
  const haystack = text.toLowerCase();
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="hl mx-0 px-0.5">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** A bordered surface. shadcn's Card with the dashboard's flat, hairline treatment. */
export function Panel({ className, ...props }: React.ComponentProps<typeof Card>) {
  return <Card className={cn('sheet gap-0 py-0 ring-0', className)} {...props} />;
}

export function PanelHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="sheet-head flex items-start gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="title">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

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

/** What sift did with a message, as a stamp. Weight carries the meaning: outline, tint, solid ink; mail left for the reader is highlighted. */
export function DispositionBadge({ disposition }: { disposition: string }) {
  const name = dispositionName(disposition);
  if (disposition === 'review') return <span className="stamp bg-highlight text-highlight-ink">{name}</span>;
  if (disposition === 'spam') return <span className="stamp bg-foreground text-background">{name}</span>;
  if (disposition === 'archive') return <span className="stamp bg-secondary text-secondary-foreground">{name}</span>;
  return <span className="stamp border border-foreground/30">{name}</span>;
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
    <p role="alert" className="sheet border-destructive/50 bg-card px-3 py-2 text-sm">
      <span className="font-medium text-destructive">Could not refresh.</span> {message} Is <code className="font-mono text-[13px]">sift dashboard</code> still
      running?
    </p>
  );
}

/** Table header and cell classes shared by every table, so they line up with the panel's 16px gutter. */
export const TH = 'slug h-9 px-4 text-muted-foreground';
export const TD = 'px-4 py-2.5';
export const NUM = 'text-right tabular-nums';
