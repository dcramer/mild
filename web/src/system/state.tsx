import type { ReactNode } from 'react';

/** What a sheet says when it has nothing to show. One plain sentence; say what would put something here if that is not obvious. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-(--gutter) py-6 text-muted-foreground">{children}</p>;
}

const WIDTHS = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5'];

/** Stands in for rows that are on their way. */
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4 px-(--gutter) py-5">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={`h-3 animate-pulse bg-(--fill-strong) motion-reduce:animate-none ${WIDTHS[index % WIDTHS.length]}`} />
      ))}
    </div>
  );
}
