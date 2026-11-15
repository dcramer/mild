import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
        <p className="slug">
          <span className={cn(tone === 'look' && 'hl', tone === 'failure' && 'text-destructive')}>{title}</span>
        </p>
      ) : null}
      {children}
    </div>
  );
}
