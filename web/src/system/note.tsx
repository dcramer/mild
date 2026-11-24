import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * Something said to the reader outside the flow of the page. `look` needs them to do something;
 * `failure` is the only place red appears. No box: the label sets it apart.
 */
export function Note({
  tone = 'plain',
  title,
  children,
  className,
}: {
  tone?: 'plain' | 'look' | 'failure';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === 'failure' ? 'alert' : undefined} className={cn('flex flex-col gap-1.5 text-sm', className)}>
      {title ? (
        <p className="font-semibold">
          <span className={cn(tone === 'look' && 'hl', tone === 'failure' && 'text-destructive')}>{title}</span>
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * What went wrong, said under the form or the press that failed. Nothing when there is nothing to say.
 * The only red a screen writes.
 */
export function Failure({ className, children }: { className?: string; children: ReactNode }) {
  if (children === null || children === undefined || children === false || children === '') return null;
  return <span className={cn('block text-destructive', className)}>{children}</span>;
}
