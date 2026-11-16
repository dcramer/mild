import type { ReactNode } from 'react';

/** What happened to one thing, oldest first, down a thin line. */
export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="flex flex-col">{children}</ol>;
}

/** One thing that happened: what (`title`), when, then the detail in quieter text, and at most one press (`action`). */
export function TimelineEvent({ title, at, action, children }: { title: ReactNode; at: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <li className="relative border-l border-(--frame) pb-5 pl-4 before:absolute before:top-2 before:-left-[3.5px] before:size-1.5 before:bg-muted-foreground last:border-transparent last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {title}
        <span className="ml-auto text-sm whitespace-nowrap text-muted-foreground tabular-nums">{at}</span>
      </div>
      {children ? <div className="mt-1 flex flex-col gap-1 text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </li>
  );
}
