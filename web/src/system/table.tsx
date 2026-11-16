import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Rows of the same kind of thing. It has no surface of its own: on the page it sits flush with the
 * heading above it, and inside a sheet it takes the sheet's gutter. On the page its rows reach a little
 * past the text on both sides, so a row's hover has room around what it holds.
 *
 * On a phone a table keeps its first column and drops those marked `phone="hide"`; what they said goes
 * under the first column in an `OnPhone`, and the row opens for the rest. A table not given that scrolls sideways.
 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-(--bleed) overflow-x-auto">
      <table className="w-full text-left">{children}</table>
    </div>
  );
}

/** A row. With `onOpen` the whole row is pressable, by pointer or keyboard. */
export function Tr({ onOpen, className, ...props }: ComponentProps<'tr'> & { onOpen?: () => void }) {
  if (!onOpen) return <tr className={cn('row group/row', className)} {...props} />;
  return (
    <tr
      tabIndex={0}
      className={cn('row group/row cursor-pointer hover:bg-(--fill) focus-visible:bg-(--fill)', className)}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen();
        }
      }}
      {...props}
    />
  );
}

const EDGES = 'first:pl-[calc(var(--gutter)+var(--bleed))] last:pr-[calc(var(--gutter)+var(--bleed))]';
const PHONE = { hide: 'hidden md:table-cell' } as const;

/** A column head. `num` lines up over figures; `phone="hide"` drops the column on a phone. */
export function Th({ num, phone, className, ...props }: ComponentProps<'th'> & { num?: boolean; phone?: keyof typeof PHONE }) {
  return (
    <th
      scope="col"
      className={cn('slug h-9 px-3 font-medium whitespace-nowrap text-muted-foreground', EDGES, num && 'text-right', phone && PHONE[phone], className)}
      {...props}
    />
  );
}

/** A cell. `num` for figures, which line up on the right; `quiet` for what supports the row without being its point. */
export function Td({ num, quiet, phone, className, ...props }: ComponentProps<'td'> & { num?: boolean; quiet?: boolean; phone?: keyof typeof PHONE }) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 align-top',
        EDGES,
        num && 'text-right tabular-nums whitespace-nowrap',
        quiet && 'text-muted-foreground',
        phone && PHONE[phone],
        className,
      )}
      {...props}
    />
  );
}

/** A second, quieter line under the point of a cell. One line; it truncates. */
export function Sub({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('mt-0.5 block truncate text-[15px] text-muted-foreground', className)}>{children}</span>;
}

/** What a row says in the columns a phone drops, under its first column. */
export function OnPhone({ children }: { children: ReactNode }) {
  return <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted-foreground md:hidden">{children}</span>;
}

/**
 * The last cell of a row: presses that act on the row without opening it. Quiet buttons only, and they
 * firm up when the row is pointed at; with `reveal` they appear only then. Dropped on a phone, where the row opens to the same actions; a row
 * that does not open keeps them (`phone="keep"`).
 */
export function RowActions({ phone, reveal, children }: { phone?: 'keep'; reveal?: boolean; children: ReactNode }) {
  return (
    <td
      className={cn(
        'w-px py-1.5 pl-3 text-right whitespace-nowrap align-top',
        phone !== 'keep' && PHONE.hide,
        // Shown on the row pointed at or focused, so a long list reads as a list.
        reveal && 'pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100',
        EDGES,
      )}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="flex items-center justify-end gap-1.5">{children}</span>
    </td>
  );
}
