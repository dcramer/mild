'use client';

/**
 * How much of a whole one thing is, as a thin bar along its row: a label's share of the mail. The figure
 * goes beside it in words; the bar is for comparing rows at a glance, so it is hidden from screen readers.
 */
export function Share({ part, whole }: { part: number; whole: number }) {
  const share = whole > 0 ? part / whole : 0;
  return (
    <span aria-hidden className="block h-1.5 w-full rounded-[2px] bg-(--rule)">
      {/* A sliver for anything at all, so a small share does not read as none. */}
      <span className="block h-full rounded-[2px] bg-muted-foreground" style={{ width: `${part > 0 ? Math.max(share * 100, 1) : 0}%` }} />
    </span>
  );
}
