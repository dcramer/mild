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
        <p className="font-medium">{title}</p>
        {note ? <div className="text-muted-foreground">{note}</div> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
