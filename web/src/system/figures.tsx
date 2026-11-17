import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Highlight } from './type.tsx';

/** A line of headline numbers, straight on the page. */
export function Figures({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('flex flex-wrap gap-x-10 gap-y-5', className)}>{children}</dl>;
}

/**
 * One number and what it counts, with a short note under it that says what it is out of. `look` highlights
 * the one the reader should see first (one a screen). With `href` the number is a link to the list it counts.
 */
export function Figure({ label, value, note, tone, href }: { label: string; value: string; note?: string | null; tone?: 'look' | undefined; href?: string }) {
  const shown = tone === 'look' ? <Highlight className="mx-0 inline-block px-1.5 py-0">{value}</Highlight> : value;
  return (
    <div className="flex flex-col gap-1">
      <dt className="slug whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className="figure">
        {href ? (
          <a href={href} className="underline decoration-current/35 decoration-2 underline-offset-[0.15em] hover:decoration-current">
            {shown}
          </a>
        ) : (
          shown
        )}
      </dd>
      {note ? <dd className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">{note}</dd> : null}
    </div>
  );
}
