import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Something most readers never need, folded away under the question that leads to it. */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="slug flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon aria-hidden className="size-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        {summary}
      </summary>
      <div className="mt-3 flex flex-col gap-2 text-[13px] text-muted-foreground">{children}</div>
    </details>
  );
}
