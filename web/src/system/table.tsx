'use client';
import { type ComponentProps, type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.ts';
import { RowActive, useLayerMoves, useOnPage, useShortcut } from './keys.tsx';
import { Control, ControlBar } from './controls.tsx';
import { Tooltip } from './tooltip.tsx';
import { useTouch } from './touch.ts';

/** How a row that opens tells its table it is there, until it goes. */
const Stops = createContext<() => () => void>(() => () => {});

/**
 * Rows of the same kind of thing. It has no surface of its own: on the page it sits flush with the
 * heading above it, and inside a sheet it takes the sheet's gutter. On the page its rows reach a little
 * past the text on both sides, so a row's hover has room around what it holds; the rules between rows
 * stay with the text.
 *
 * `keys`: J and K, or ↓ and ↑, move through it, with the page's controls bar under it. Only for a list someone works
 * through one item after another (For review, Activity); every other list is pressed or tabbed through.
 *
 * `dense`: a row a line of small type, close set, for a list as long as a mailbox (Inbox).
 *
 * On a phone a table keeps its first column and drops those marked `phone="hide"`; what they said goes
 * under the first column in an `OnPhone`, and the row opens for the rest. A table not given that scrolls sideways.
 */
export function Table({ keys = false, dense = false, children }: { keys?: boolean; dense?: boolean; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  // Where the reader was, so that after a row is answered and gone the next key carries on from there.
  const last = useRef(0);
  // In a panel J and K step through the panel's own list.
  const moves = !useLayerMoves();
  const onPage = useOnPage();
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
  // The rows J and K stop at: until there is one, the keys and their bar are not offered.
  const [stops, setStops] = useState(0);
  const [stop] = useState(() => () => {
    setStops((n) => n + 1);
    return () => setStops((n) => n - 1);
  });
  const live = { enabled: keys && moves && stops > 0, within };
  const down = useShortcut(['j', 'ArrowDown'], 'Next row', () => step(1), live);
  const up = useShortcut(['k', 'ArrowUp'], 'Previous row', () => step(-1), live);
  return (
    <div ref={element} className="bleed">
      {/* The bar below sits outside the sideways scroll, which would otherwise hold it in place instead of the screen. */}
      {/* A table in days is clipped rather than scrolled on a phone, where it keeps one column: a scroll here would hold a day's sticky heading to the table. */}
      <div className="overflow-x-auto phone:has-[th[scope=colgroup]]:overflow-x-clip">
        {/* In a row, the quiet ink is the third strength: what places the row (when, an address, a count) under what it says. */}
        <table className={cn('group/table w-full text-left [&_tbody_td]:[--muted-foreground:var(--faint)]', dense && 'dense md:text-sm')}>
          <Stops value={stop}>{children}</Stops>
        </table>
      </div>
      {onPage && (down || up) ? (
        // The page's controls, held at the bottom of the screen while the table is on it.
        <ControlBar className="rule-above sticky bottom-0 z-10 mt-3 hidden bg-background px-(--bleed) py-1.5 [--muted-foreground:var(--faint)] md:flex">
          <Control keys={['j', 'k', 'ArrowDown', 'ArrowUp']} label="Move" />
          <Control keys={['Enter']} label="Open" />
          <Control keys={['?']} label="Every key" />
        </ControlBar>
      ) : null}
    </div>
  );
}

/**
 * A row. With `onOpen` the whole row is pressable, by pointer or keyboard, and it is a stop for J and K.
 * The keys of the buttons in a row are live, and drawn, only while the reader is on that row.
 * `holds` names what the row opens, so a panel that stepped away from it can come back to the row it ended on (`rowHolding`).
 * `selected`: its `RowCheck` is checked, which fills it as pointing at it does; the row the keys are on fills more.
 * `onHold`: a finger held on it, where a phone has no `RowCheck`, selects it.
 */
export function Tr({
  onOpen,
  onHold,
  holds,
  selected = false,
  className,
  ...props
}: ComponentProps<'tr'> & { onOpen?: () => void; onHold?: () => void; holds?: readonly string[]; selected?: boolean }) {
  const [active, setActive] = useState(false);
  // A finger held on the row (`onHold`), not moved and not taken by a scroll or a swipe. The press it ends in opens nothing.
  const holding = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const letGo = () => {
    if (holding.current) clearTimeout(holding.current.timer);
    holding.current = null;
  };
  const stop = useContext(Stops);
  const opens = onOpen !== undefined;
  useEffect(() => (opens ? stop() : undefined), [opens, stop]);
  if (!onOpen) return <tr className={cn('row group/row', selected && 'bg-(--row)', className)} {...props} />;
  return (
    <RowActive value={active}>
      <tr
        tabIndex={0}
        data-holds={holds?.join(' ')}
        className={cn(
          'row group/row cursor-pointer hover:bg-(--row) focus-visible:bg-(--row-strong) focus-within:bg-(--row) has-[[data-popup-open]]:bg-(--row) active:bg-(--row-strong)',
          selected && 'bg-(--row)',
          className,
        )}
        onPointerDown={(event) => {
          holdEnding = false;
          // A finger that lands while the page or a row still moves stops it: that is not a press.
          if (!onHold || event.pointerType === 'mouse' || Date.now() - scrolledAt < COASTING_MS) return;
          const { clientX: x, clientY: y } = event;
          const since = Date.now();
          const timer = setTimeout(() => {
            holding.current = null;
            // Anything scrolled since it landed, the page or the row's own swipe, made it a scroll.
            if (scrolledAt >= since) return;
            holdEnding = true;
            onHold();
          }, HOLD_MS);
          holding.current = { timer, x, y };
        }}
        onPointerMove={(event) => {
          const at = holding.current;
          if (at && Math.hypot(event.clientX - at.x, event.clientY - at.y) > STRAY_PX) letGo();
        }}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onContextMenu={(event) => {
          if (holdEnding) event.preventDefault();
        }}
        onClick={(event) => {
          if (holdEnding) {
            holdEnding = false;
            return;
          }
          // React passes up presses in what a row renders elsewhere, such as a dialog it opened; those are not on the row.
          // Nor is a press on a link in it, which goes where the link does.
          const target = event.target as Element;
          if (event.currentTarget.contains(target) && !event.currentTarget.contains(target.closest('a'))) onOpen();
        }}
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

// The press a hold ends in, which lands on whatever row is under the finger by then: the rows may have moved.
let holdEnding = false;

/** How long a finger rests on a row to select it, as a phone's own lists take it. */
const HOLD_MS = 500;
/** How far it may drift meanwhile, in pixels, before it is a scroll or a swipe instead. */
const STRAY_PX = 10;
/** A touch this soon after anything scrolled stops a scroll still coasting, as a phone's own lists take it. */
const COASTING_MS = 100;

/** When anything on the page last scrolled: a phone does not always say a touch became a scroll (`pointercancel`). */
let scrolledAt = -Infinity;
if (typeof window !== 'undefined')
  window.addEventListener(
    'scroll',
    (event) => {
      // A row's swipe put back at rest as it is drawn or resized (`Swipe`) is not the list moving.
      const { target } = event;
      if (target instanceof HTMLElement && target.dataset.rest !== undefined && Math.abs(target.scrollLeft - Number(target.dataset.rest)) <= 1) return;
      scrolledAt = Date.now();
    },
    { capture: true, passive: true },
  );

/** The row on the page that holds `name`, if one does. */
export const rowHolding = (name: string) => document.querySelector<HTMLElement>(`tr[data-holds~="${CSS.escape(name)}"]`);

const EDGES = 'first:pl-[calc(var(--gutter)+var(--bleed))] last:pr-[calc(var(--gutter)+var(--bleed))]';
const PHONE = { hide: 'hidden md:table-cell' } as const;

/**
 * A table's column heads, one `Th` each. Unshown, they are for screen readers alone: a list that reads as
 * plain rows (a sender, a subject, what Mild did). `shown` once a figure or a date would not say what it is
 * without one, as soon as there are two beside the first column: `wide` where a phone drops those columns,
 * `always` where it keeps some.
 */
export function Heads({ shown, children }: { shown?: 'wide' | 'always'; children: ReactNode }) {
  return (
    <thead className={shown === 'always' ? undefined : shown === 'wide' ? 'phone:sr-only' : 'sr-only'}>
      <tr>{children}</tr>
    </thead>
  );
}

type Cell<T extends 'th' | 'td'> = Omit<ComponentProps<T>, 'title'> & {
  phone?: keyof typeof PHONE;
  /** What the column or the value means beyond its words, in a `Tooltip`. */
  says?: ReactNode;
};

/**
 * A column head: small, tight capitals in quiet ink, over what it heads. `num` lines up over figures;
 * `phone="hide"` drops the column on a phone; `says` says more when pointed at.
 */
export function Th({ num, phone, says, className, children, ...props }: Cell<'th'> & { num?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 px-3 text-head font-semibold tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase',
        EDGES,
        num && 'text-right',
        phone && PHONE[phone],
        className,
      )}
      {...props}
    >
      {says ? <Tooltip says={says}>{children}</Tooltip> : children}
    </th>
  );
}

/** A cell. `num` for figures, which line up on the right; `quiet` for what supports the row without being its point. */
export function Td({ num, quiet, phone, says, className, children, ...props }: Cell<'td'> & { num?: boolean; quiet?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 align-middle group-[.dense]/table:md:py-1',
        EDGES,
        num && 'text-right tabular-nums whitespace-nowrap',
        quiet && 'text-muted-foreground',
        phone && PHONE[phone],
        className,
      )}
      {...props}
    >
      {says ? <Tooltip says={says}>{children}</Tooltip> : children}
    </td>
  );
}

/**
 * A heading for the rows after it inside one table, such as a day, so the rows keep one set of keys and
 * one column layout across groups. Put each group in its own `tbody`; `span` is the table's column count.
 */
export function TrGroup({ title, span }: { title: string; span: number }) {
  return (
    <tr>
      <th
        colSpan={span}
        scope="colgroup"
        className={cn(
          // A small, quiet line, so the rows under it read as one run.
          'pt-6 pb-1.5 text-left text-sm font-semibold text-faint [tbody:first-of-type_&]:pt-1',
          // On a phone it stays under the top bar while its rows pass, so the day is always said.
          'phone:sticky phone:top-(--bar) phone:z-[5] phone:bg-background phone:pt-2 phone:font-normal phone:[tbody:first-of-type_&]:pt-2',
          EDGES,
        )}
      >
        {title}
      </th>
    </tr>
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
      className={cn('w-px py-1.5 pl-3 text-right whitespace-nowrap align-middle', phone !== 'keep' && PHONE.hide, EDGES)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="flex items-center justify-end gap-1.5">{children}</span>
    </td>
  );
}

/**
 * The row pointed at, or the one the keys are on (the row itself, or a press in it, reached by keys): not a row whose check
 * was clicked, which keeps the focus while the pointer moves on. A row whose menu is open stays so while the pointer is in
 * the menu, which is outside the row: hidden, the press it opened from would leave it nothing to stand under.
 */
const ON_ROW = 'group-hover/row:flex group-focus-visible/row:flex group-has-focus-visible/row:flex group-has-[[data-popup-open]]/row:flex';
/** What the presses take the place of, hidden where they show; Tailwind finds whole class names only. */
const OFF_ROW = 'group-hover/row:invisible group-focus-visible/row:invisible group-has-focus-visible/row:invisible group-has-[[data-popup-open]]/row:invisible';

/** The block a row's presses sit on: a shade lighter than the row, and solid, since it covers the end of the row's text. */
const TRAY = '[background:linear-gradient(var(--fill),var(--fill)),linear-gradient(var(--fill),var(--fill)),var(--surface)]';

/**
 * The last cell of a row whose presses act on it without opening it, as a mail app's do: it says something (when the mail
 * came), and while the row is pointed at, or the keys are on it, the presses take its place, on a block a shade lighter
 * than the row, its edge on the time's, reaching left over the row's text as far as they need. Icon presses (`bare`,
 * `size="tray"`), each named in a `Tooltip`. `lead` goes first on the block, set apart by a rule: what the row's mail is
 * (`LabelPick`), so it can be changed without being covered. `mark` sits before what the cell says, in a slot of its own
 * at the cell's start so a column of them lines up; pass null on a row without one. On a touch screen, where nothing is
 * pointed at, it only says what it says, and the row opens to the same presses. Dropped on a phone.
 *
 * The presses are drawn the first time the row is pointed at or the keys reach it, and kept: a list's first screen draws
 * a label menu and three tooltips for every row otherwise, which on a phone's processor held it most of a second.
 */
export function RowPresses({ lead, mark, presses, children }: { lead?: ReactNode; mark?: ReactNode; presses: ReactNode; children: ReactNode }) {
  const touch = useTouch();
  const cell = useRef<HTMLTableCellElement>(null);
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    const row = cell.current?.closest('tr');
    if (touch || wanted || !row) return;
    const want = () => setWanted(true);
    row.addEventListener('pointerenter', want);
    row.addEventListener('focusin', want);
    return () => {
      row.removeEventListener('pointerenter', want);
      row.removeEventListener('focusin', want);
    };
  }, [touch, wanted]);
  return (
    <td
      ref={cell}
      className={cn('w-px py-1 pl-3 align-middle whitespace-nowrap text-muted-foreground', PHONE.hide, EDGES)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="relative flex h-(--control) min-w-20 items-center justify-end">
        <span className={cn('flex flex-1 items-center justify-between gap-2.5 tabular-nums', !touch && OFF_ROW)}>
          {mark === undefined ? null : <span className="flex w-3.5 justify-center">{mark}</span>}
          <span className="ml-auto">{children}</span>
        </span>
        {touch || !wanted ? null : (
          <span className={cn('absolute top-1/2 right-0 hidden -translate-y-1/2 items-center gap-1.5 rounded-[2px]', TRAY, ON_ROW)}>
            {lead === undefined ? null : (
              <>
                {lead}
                <span aria-hidden className="h-4 border-l border-(--frame)" />
              </>
            )}
            {presses}
          </span>
        )}
      </span>
    </td>
  );
}

/**
 * The first cell of a row that can be selected with others, for what the list's bar does to all of them at once (Inbox's
 * Archive). Pressing it, or X on the row the reader is on, selects the row without opening it. Dropped on a phone,
 * where the row opens to the same presses.
 */
export function RowCheck({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  // X selects the row the keys are on; it is in the list of every key, and nothing is drawn beside the check.
  void useShortcut('x', 'Select', () => onChange(!checked));
  return (
    <td
      className={cn('w-px py-1.5 pr-1 align-middle', PHONE.hide, EDGES)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <label className="flex h-(--control) cursor-pointer items-center">
        <input
          type="checkbox"
          aria-label={label}
          className="size-3.5 cursor-pointer accent-foreground"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    </td>
  );
}
