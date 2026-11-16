import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A group of settings that belong together, set apart by a frame alone: it has no fill of its own, so
 * the page shows through. Its heading is a `Section` above it. Not for a list (that is a `Table`).
 */
export function Sheet({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('sheet flex flex-col text-sm', className)} {...props} />;
}

/**
 * One thing that can be set, as a row of a sheet: what it is, what follows from it (`note`, said before it
 * is changed), and the control. The control wraps under the text on a narrow screen.
 */
export function SettingRow({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row flex flex-wrap items-center gap-x-6 gap-y-2.5 px-4 py-3.5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="name">{title}</p>
        {note ? <div className="mt-0.5 text-muted-foreground">{note}</div> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * One part of a settings page: its name and what it governs on the left, its sheet on the right, and a
 * rule above it that sets it apart from the part before. On a narrow screen the two stack.
 */
export function SettingsGroup({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-x-12 gap-y-4 border-t border-(--rule) pt-8 first-of-type:border-t-0 first-of-type:pt-0 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div>
        <h2 className="heading">{title}</h2>
        {note ? <div className="mt-1.5 text-sm text-muted-foreground">{note}</div> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}
