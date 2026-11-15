import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The surface everything sits on: a framed sheet with the edge of the one beneath showing. */
export function Sheet({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('sheet flex flex-col bg-card text-sm text-card-foreground', className)} {...props} />;
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
