import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Highlight } from './type.tsx';

/** A line of headline numbers, straight on the page. */
export function Figures({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('flex flex-wrap gap-x-10 gap-y-5', className)}>{children}</dl>;
}

/** One number and what it counts. `look` highlights the one the reader should see first; `failure` is for a count of things gone wrong. */
export function Figure({ label, value, note, tone }: { label: string; value: string; note?: string | null; tone?: 'look' | 'failure' | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="slug whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className={cn('figure', tone === 'failure' && 'text-destructive')}>
        {tone === 'look' ? <Highlight className="mx-0 inline-block px-2 py-0">{value}</Highlight> : value}
      </dd>
      {note ? <dd className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">{note}</dd> : null}
    </div>
  );
}
