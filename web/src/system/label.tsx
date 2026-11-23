import { TagIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * A label named in words, the same everywhere: its tag, then its name, which keeps the weight and colour of the words
 * around it. The tag is the size of the name, so a label in a heading keeps them in step.
 */
export function LabelName({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-top whitespace-nowrap">
      <TagIcon aria-hidden className="size-[0.85em] shrink-0 text-muted-foreground" />
      {children}
    </span>
  );
}

/** A label as a thing of its own, where several sit in a row: what a press gave (a toast), what a change added or took off. */
export function LabelChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1.5 bg-(--fill-strong) px-1.5 text-label font-semibold whitespace-nowrap text-foreground">
      <TagIcon aria-hidden className="size-3" />
      {children}
    </span>
  );
}
