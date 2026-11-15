import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Rows of the same kind of thing. It has no surface of its own: on the page it sits flush with the
 * heading above it, and inside a sheet it takes the sheet's gutter. Scrolls sideways when too narrow.
 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">{children}</table>
    </div>
  );
}

/** A row. With `onOpen` the whole row is pressable, by pointer or keyboard. */
export function Tr({ onOpen, className, ...props }: ComponentProps<'tr'> & { onOpen?: () => void }) {
  if (!onOpen) return <tr className={cn('row', className)} {...props} />;
  return (
    <tr
      tabIndex={0}
      className={cn('row cursor-pointer hover:bg-(--fill) focus-visible:bg-(--fill)', className)}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      {...props}
    />
  );
}

export function Th({ num, className, ...props }: ComponentProps<'th'> & { num?: boolean }) {
  return (
    <th
      scope="col"
      className={cn('slug h-9 px-3 font-medium whitespace-nowrap text-muted-foreground first:pl-(--gutter) last:pr-(--gutter)', num && 'text-right', className)}
      {...props}
    />
  );
}

/** A cell. `num` for figures, which line up on the right; `quiet` for what supports the row without being its point. */
export function Td({ num, quiet, className, ...props }: ComponentProps<'td'> & { num?: boolean; quiet?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 align-top first:pl-(--gutter) last:pr-(--gutter)',
        num && 'text-right tabular-nums',
        quiet && 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
