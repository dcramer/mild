import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A group of things that belong together, set apart by a frame alone: it has no fill of its own, so the page shows through. */
export function Sheet({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('sheet flex flex-col text-sm', className)} {...props} />;
}

export function SheetHead({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-4 px-4 pt-4 pb-2">
      <div className="min-w-0 flex-1">
        <h2 className="title">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
