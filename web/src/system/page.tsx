import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The top of a page: its name, one line of where things stand (what is waiting, how many there are), and
 * the page's own action. No explanation: that belongs where it is needed, in an empty state or beside a
 * control. `badge` sits beside the title, for a stamp that says what the page's subject is.
 */
export function PageHeader({ title, badge, meta, actions }: { title: string; badge?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="statement break-words">{title}</h1>
          {badge}
        </div>
        {meta ? <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground tabular-nums">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * A part of a page or a panel under its own heading: the heading, a count or short fact beside it, and
 * at most one action on the right. Space sets it apart; it has no rule or box.
 */
export function Section({
  title,
  meta,
  action,
  children,
  className,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-3', className)}>
      <header className="flex min-h-(--control) flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="heading">{title}</h2>
        {meta ? <span className="text-muted-foreground tabular-nums">{meta}</span> : null}
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
