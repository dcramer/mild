import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { RowActive, keyName, useLayerMoves, useShortcut } from './keys.tsx';
import { Kbd } from './type.tsx';

/**
 * Rows of the same kind of thing. It has no surface of its own: on the page it sits flush with the
 * heading above it, and inside a sheet it takes the sheet's gutter. On the page its rows reach a little
 * past the text on both sides, so a row's hover has room around what it holds.
 *
 * On a phone a table keeps its first column and drops those marked `phone="hide"`; what they said goes
 * under the first column in an `OnPhone`, and the row opens for the rest. A table not given that scrolls sideways.
 */
export function Table({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  // Where the reader was, so that after a row is answered and gone the next key carries on from there.
  const last = useRef(0);
  // In a panel J and K step through the panel's own list.
  const moves = !useLayerMoves();
  const rows = () => [...(element.current?.querySelectorAll<HTMLElement>('tbody > tr[tabindex="0"]') ?? [])];
  const within = () => element.current;
  const step = (by: number) => {
    const all = rows();
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = at === -1 ? Math.min(last.current, all.length - 1) : Math.min(Math.max(at + by, 0), all.length - 1);
    last.current = next;
    all[next]?.focus();
    all[next]?.scrollIntoView({ block: 'nearest' });
  };
  const [openable, setOpenable] = useState(false);
  useEffect(() => setOpenable(rows().length > 0));
  const live = { enabled: moves && openable, within };
  const down = useShortcut('j', 'Next row', () => step(1), live);
  const up = useShortcut('k', 'Previous row', () => step(-1), live);
  return (
    <div ref={element} className="-mx-(--bleed) overflow-x-auto">
      <table className="w-full text-left">{children}</table>
      {down ? (
        <p className="hidden items-center gap-1.5 px-(--bleed) pt-3 text-label text-muted-foreground md:flex">
          {down}
          {up}
          <span>to move</span>
          <Kbd className="ml-2">{keyName('Enter')}</Kbd>
          <span>to open</span>
          <Kbd className="ml-2">?</Kbd>
          <span>for every key</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * A row. With `onOpen` the whole row is pressable, by pointer or keyboard, and it is a stop for J and K.
 * The keys of the buttons in a row are live, and drawn, only while the reader is on that row.
 */
export function Tr({ onOpen, className, ...props }: ComponentProps<'tr'> & { onOpen?: () => void }) {
  const [active, setActive] = useState(false);
  if (!onOpen) return <tr className={cn('row group/row', className)} {...props} />;
  return (
    <RowActive value={active}>
      <tr
        tabIndex={0}
        className={cn('row group/row cursor-pointer hover:bg-(--fill) focus-visible:bg-(--fill) focus-within:bg-(--fill)', className)}
        onClick={onOpen}
        onFocus={() => setActive(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
        }}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ' || event.key === 'o')) {
            event.preventDefault();
            onOpen();
          }
        }}
        {...props}
      />
    </RowActive>
  );
}

const EDGES = 'first:pl-[calc(var(--gutter)+var(--bleed))] last:pr-[calc(var(--gutter)+var(--bleed))]';
const PHONE = { hide: 'hidden md:table-cell' } as const;

/** A column head. `num` lines up over figures; `phone="hide"` drops the column on a phone. */
export function Th({ num, phone, className, ...props }: ComponentProps<'th'> & { num?: boolean; phone?: keyof typeof PHONE }) {
  return (
    <th
      scope="col"
      className={cn('slug h-9 px-3 whitespace-nowrap text-muted-foreground', EDGES, num && 'text-right', phone && PHONE[phone], className)}
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
  return <span className={cn('mt-0.5 block truncate text-sm text-muted-foreground', className)}>{children}</span>;
}

/** What a row says in the columns a phone drops, under its first column. */
export function OnPhone({ children }: { children: ReactNode }) {
  return <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground md:hidden">{children}</span>;
}

/**
 * The last cell of a row: presses that act on the row without opening it. Quiet buttons only, and they
 * firm up when the row is pointed at. Dropped on a phone, where the row opens to the same actions; a row
 * that does not open keeps them (`phone="keep"`).
 */
export function RowActions({ phone, children }: { phone?: 'keep'; children: ReactNode }) {
  return (
    <td
      className={cn('w-px py-1.5 pl-3 text-right whitespace-nowrap align-top', phone !== 'keep' && PHONE.hide, EDGES)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="flex items-center justify-end gap-1.5">{children}</span>
    </td>
  );
}
