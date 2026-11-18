import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Anchor } from './anchor.tsx';
import { Highlight } from './type.tsx';

/** A line of headline numbers, straight on the page. `compact`: in a column as narrow as a card, the figures at a name's size, in even columns. */
export function Figures({ children, compact, className }: { children: ReactNode; compact?: boolean; className?: string }) {
  return <dl className={cn(compact ? 'grid auto-cols-fr grid-flow-col gap-x-4' : 'flex flex-wrap gap-x-10 gap-y-5', className)}>{children}</dl>;
}

/**
 * One number and what it counts, with a short note under it that says what it is out of. `look` highlights
 * the one the reader should see first (one a screen). With `href` the number is a link to the list it counts.
 * `compact` inside `Figures compact`.
 */
export function Figure({
  label,
  value,
  note,
  tone,
  href,
  compact,
}: {
  label: string;
  value: string;
  note?: string | null;
  tone?: 'look' | undefined;
  href?: string;
  compact?: boolean;
}) {
  const shown = tone === 'look' ? <Highlight className="mx-0 inline-block px-1.5 py-0">{value}</Highlight> : value;
  return (
    <div className="flex flex-col gap-1">
      <dt className="slug whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className={cn(compact ? 'name tabular-nums' : 'figure')}>
        {href ? (
          <Anchor href={href} className="underline decoration-current/35 decoration-2 underline-offset-[0.15em] hover:decoration-current">
            {shown}
          </Anchor>
        ) : (
          shown
        )}
      </dd>
      {note ? <dd className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">{note}</dd> : null}
    </div>
  );
}
