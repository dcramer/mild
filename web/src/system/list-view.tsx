'use client';
import { ArrowLeftIcon, CheckIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { type ReactNode, createContext, useContext, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { count } from '@/lib/format.ts';
import { cn } from '@/lib/utils';
import { useBackCloses } from '@/lib/params.ts';
import { Button } from './button.tsx';
import { useShortcut } from './keys.tsx';
import { Mailbox } from '@/lib/narrowed.ts';
import { Narrowed } from './mailbox.tsx';
import { BarSlot, ToBar } from './nav.tsx';
import { type Thumb, ThumbBar } from './thumbs.tsx';

/** Where a list's views go on a phone; and the page's own action, which a desktop draws beside the list's search. */
const Views = createContext<{ at: HTMLElement | null; actions?: ReactNode }>({ at: null });

/** Draws the list's views in its head on a phone. */
function ToViews({ children }: { children: ReactNode }) {
  const { at } = useContext(Views);
  return at ? createPortal(children, at) : null;
}

/**
 * A `ListPage`'s head: its name, the mailbox it is narrowed to, and the page's own action on the right. On a phone it
 * is one line under the top bar, holding the list's views as tabs, the mailbox and the action, and nothing while there
 * are none: the `TabBar` names the page. A desktop draws none of it: the rail already names the page, so the name is for
 * screen readers, and the mailbox and the action go beside the list's search (`ListView`).
 */
export function ListHead({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const [at, setAt] = useState<HTMLElement | null>(null);
  return (
    <section className="flex flex-col gap-6 phone:gap-0">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 phone:flex-nowrap phone:gap-x-2 md:sr-only phone:[html:has([data-searching])_&]:hidden">
        <div className="flex min-w-0 flex-1 basis-40 flex-wrap items-center gap-x-3 gap-y-1">
          <span ref={setAt} className="peer flex min-w-0 empty:hidden md:hidden" />
          {/* The tab bar names the page on a phone. */}
          <h1 className="statement list-title min-w-0 wrap-anywhere phone:sr-only">{title}</h1>
          <span className="md:hidden">
            <Narrowed />
          </span>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 md:hidden">{actions}</div> : null}
      </header>
      <Views value={{ at, actions }}>{children}</Views>
    </section>
  );
}

interface ActiveFilter {
  /** What is being narrowed and to what: "Label: Newsletters". */
  label: string;
  clear: () => void;
}

/**
 * The standard way to show many of one thing, inside a `ListPage`: `intro` (anything the page shows before its
 * list), then one outlined bar holding the search and the filter button, then the rows. With `search.ask`, words in the
 * search can be put to the model, which answers with filters that then show as any others do. While rows are selected
 * (`RowCheck`), the bar holds what to do with them in place of the search (`selected`): how many, the presses, and a
 * way to select none, so the rows do not move.
 *
 * The filter button opens a panel on the right that pushes the list left; closing it puts the list
 * back. While closed, the button shows how many filters are on and each is listed under the search
 * box with a way to clear it, so a narrowed list never looks like the whole of it.
 *
 * A desktop names the page only in its rail: the page's own action, and the mailbox it is narrowed to, end the bar,
 * or sit on a line of their own at the top where `intro` comes before the bar or the list has none.
 *
 * On a phone the search is the top bar (`ToBar`) and the views are tabs under it (`ListHead`). Pressing the search
 * makes it a screen of its own: Back in place of the menu, the filters until something is typed, then what it finds,
 * with nothing else of the page around it; Back, or the browser's, clears the search and leaves it.
 */
export function ListView({
  intro,
  search,
  view,
  filters,
  selected,
  children,
}: {
  /** What the page shows between its header and its list. */
  intro?: ReactNode;
  /** `ask`: what is typed can also be put to the model (Inbox), by a press at the end of the box or Enter. */
  search?: { value: string; onChange: (value: string) => void; placeholder: string; ask?: { onAsk: () => void; busy: boolean } };
  /** Which of a few ways to see the list, as segments at the end of the search bar: "Changed" or "Everything". */
  view?: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void };
  filters?: { panel: ReactNode; active: ActiveFilter[] };
  /** Rows selected, and what can be done to all of them, each with its key; on a phone, `thumbs` along the bottom. */
  selected?: { count: number; clear: () => void; actions: readonly { label: string; key: string; onPress: () => void }[]; thumbs?: readonly Thumb[] };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const slash = useShortcut('/', 'Search', () => searchBox.current?.focus(), { enabled: search !== undefined && !(selected && selected.count > 0) });
  const on = filters?.active.length ?? 0;
  const bar = useContext(BarSlot);
  const { actions } = useContext(Views);
  // On a phone, the search once pressed is a screen of its own: the filters until something is typed, then what it finds.
  const [searching, setSearching] = useState(false);
  useBackCloses(searching, () => setSearching(false));
  const panel = open || (searching && search?.value.trim() === '');
  const mailbox = useContext(Mailbox);
  // A desktop's only head: the mailbox and the page's action, at the top of the page. Beside the search when it comes
  // first; on a line of their own over what the page shows before it, which they govern too (Activity's period), or over
  // a list with no search.
  const aside =
    actions || mailbox ? (
      <div className="hidden shrink-0 items-center justify-end gap-2 md:flex">
        <Narrowed />
        {actions}
      </div>
    ) : null;
  return (
    <>
      {view ? (
        <ToViews>
          <div role="radiogroup" aria-label={view.label} className="-ml-2.5 flex h-11 items-stretch overflow-x-auto">
            {view.options.map(([key, text]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={key === view.value}
                className="relative shrink-0 cursor-pointer px-2.5 text-sm font-semibold text-muted-foreground after:absolute after:inset-x-2.5 after:bottom-1.5 after:h-0.5 aria-checked:text-foreground aria-checked:after:bg-foreground"
                onClick={() => view.onChange(key)}
              >
                {text}
              </button>
            ))}
          </div>
        </ToViews>
      ) : null}
      {intro ? aside : null}
      {searching ? null : intro}
      {/* On a phone the search is the top bar; while rows are selected, how many, and what to do with them along the bottom. */}
      {selected && selected.count > 0 ? (
        <>
          <ToBar>
            <span className="flex h-full min-w-0 flex-1 items-center text-base font-semibold tabular-nums">{selected.count} selected</span>
            <button
              type="button"
              aria-label="Select none"
              className="press flex size-11 shrink-0 cursor-pointer items-center justify-center"
              onClick={selected.clear}
            >
              <XIcon aria-hidden className="size-5" />
            </button>
          </ToBar>
        </>
      ) : search ? (
        <ToBar>
          {searching ? (
            <>
              <span data-searching hidden />
              <button
                type="button"
                aria-label="Back"
                className="press flex size-11 shrink-0 cursor-pointer items-center justify-center"
                onClick={() => {
                  search.onChange('');
                  setSearching(false);
                }}
              >
                <ArrowLeftIcon aria-hidden className="size-5" />
              </button>
            </>
          ) : null}
          <label className="flex h-full min-w-0 flex-1 items-center gap-2.5 pr-1">
            <input
              type="search"
              onFocus={() => setSearching(true)}
              className="focus-within-shown min-w-0 flex-1 bg-transparent text-base placeholder:text-muted-foreground"
              aria-label={search.placeholder}
              placeholder={search.placeholder}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && search.ask && search.value.trim() !== '' && !search.ask.busy) search.ask.onAsk();
              }}
            />
            {search.ask && search.value.trim() !== '' ? (
              <Button variant="quiet" busy={search.ask.busy} onClick={search.ask.onAsk}>
                Ask
              </Button>
            ) : null}
          </label>
        </ToBar>
      ) : null}

      <div className="flex flex-col gap-3">
        {search || filters || view ? (
          // On a phone the search is the top bar: nothing is left here but the filters that are on.
          <div className={cn('flex flex-col gap-2', search && bar !== undefined && !(on > 0 && !panel) && 'phone:hidden')}>
            <div className="flex items-center gap-3">
              {/* One bar: the search and the filters share an outline, and nothing is filled until it is used. On a phone they are the top bar. */}
              <div
                className={cn(
                  'flex min-w-0 flex-1 flex-wrap items-stretch rounded-(--corner) border border-(--frame) transition-colors focus-within:border-foreground/45 md:flex-nowrap',
                  search && bar !== undefined && 'phone:hidden',
                )}
              >
                {selected && selected.count > 0 ? (
                  <div role="toolbar" aria-label="Selected rows" className="flex h-9 min-w-0 flex-1 items-center gap-1 pr-1 pl-3">
                    <span className="mr-2 text-sm font-semibold tabular-nums">{selected.count} selected</span>
                    {selected.actions.map((action) => (
                      <Button key={action.label} variant="quiet" shortcut={action.key} onClick={action.onPress}>
                        {action.label}
                      </Button>
                    ))}
                    <Button variant="quiet" size="icon" className="ml-auto" aria-label="Select none" onClick={selected.clear}>
                      <XIcon aria-hidden />
                    </Button>
                  </div>
                ) : search ? (
                  <label className="flex h-9 min-w-0 flex-1 items-center gap-2.5 px-3">
                    <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      ref={searchBox}
                      type="search"
                      className="focus-within-shown min-w-0 flex-1 bg-transparent text-base placeholder:text-muted-foreground"
                      aria-label={search.placeholder}
                      aria-keyshortcuts="/"
                      placeholder={search.placeholder}
                      value={search.value}
                      onChange={(event) => search.onChange(event.target.value)}
                      // Escape hands the keys back to the list.
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') event.currentTarget.blur();
                        else if (event.key === 'Enter' && search.ask && search.value.trim() !== '' && !search.ask.busy) search.ask.onAsk();
                      }}
                    />
                    {slash}
                    {search.ask && search.value.trim() !== '' ? (
                      <Button variant="quiet" className="-mr-2" busy={search.ask.busy} onClick={search.ask.onAsk}>
                        Ask
                      </Button>
                    ) : null}
                  </label>
                ) : (
                  <span className="h-9 flex-1" />
                )}
                {view ? (
                  <div role="radiogroup" aria-label={view.label} className="hidden h-9 shrink-0 border-l border-(--frame) md:flex">
                    {view.options.map(([key, text]) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={key === view.value}
                        className="flex-1 cursor-pointer px-3 text-sm font-medium text-muted-foreground hover:bg-(--fill) hover:text-foreground aria-checked:bg-(--fill-strong) aria-checked:text-foreground md:flex-none"
                        onClick={() => view.onChange(key)}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                ) : null}
                {filters ? (
                  <button
                    type="button"
                    aria-label={on > 0 ? `Filters, ${on} on` : 'Filters'}
                    aria-expanded={open}
                    className={cn(
                      'flex h-9 shrink-0 cursor-pointer items-center gap-2 border-l border-(--frame) px-3 text-sm font-semibold',
                      open ? 'bg-(--fill-strong)' : 'text-muted-foreground hover:bg-(--fill) hover:text-foreground',
                    )}
                    onClick={() => setOpen(!open)}
                  >
                    <SlidersHorizontalIcon aria-hidden className="size-4" />
                    Filters
                    {on > 0 ? <span className="hl mx-0 px-1.5 py-0 text-sm tabular-nums">{on}</span> : null}
                  </button>
                ) : null}
              </div>
              {intro ? null : aside}
            </div>
            {on > 0 && !panel ? (
              <ul className="flex flex-wrap items-center gap-1.5" aria-label="Filters that are on">
                {filters?.active.map((filter) => (
                  <li key={filter.label}>
                    <button
                      type="button"
                      aria-label={`Clear ${filter.label}`}
                      className="press flex h-6 cursor-pointer items-center gap-1 bg-(--fill) pr-1.5 pl-2 text-sm font-medium hover:bg-(--fill-strong)"
                      onClick={filter.clear}
                    >
                      {filter.label}
                      <XIcon aria-hidden className="size-3 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : intro ? null : (
          aside
        )}

        <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-4', open && 'md:grid-cols-[minmax(0,1fr)_15rem]')}>
          <div className="flex min-w-0 flex-col gap-3 md:order-1">
            {children}
            {/* After the rows, so the room it keeps at the end of the page does not push them down as it comes. */}
            {selected && selected.count > 0 && selected.thumbs ? <ThumbBar thumbs={selected.thumbs} /> : null}
          </div>
          {panel && filters ? (
            <aside aria-label="Filters" className="order-first flex flex-col gap-5 md:order-2 md:border-l md:border-dashed md:border-(--rule) md:pl-4">
              <div className="flex items-center justify-between">
                <p className="slug text-muted-foreground">Filters</p>
                {on > 0 ? (
                  <Button variant="quiet" className="-my-1 -mr-2" onClick={() => filters.active.forEach((filter) => filter.clear())}>
                    Clear all
                  </Button>
                ) : null}
              </div>
              {filters.panel}
            </aside>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * Under a list too long for one page (Activity, Contacts): which of its rows these are and how many in all, and the
 * presses to the page before and after, newest first. Nothing while the list fits on one.
 */
export function Pager({ offset, size, total, onGo }: { offset: number; size: number; total: number; onGo: (offset: number) => void }) {
  if (total <= size) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground tabular-nums">
      <span>
        {count(offset + 1)}–{count(Math.min(offset + size, total))} of {count(total)}
      </span>
      <Button disabled={offset === 0} onClick={() => onGo(Math.max(0, offset - size))}>
        Newer
      </Button>
      <Button disabled={offset + size >= total} onClick={() => onGo(offset + size)}>
        Older
      </Button>
    </div>
  );
}

/**
 * One thing a list can be narrowed by, in the filter panel: a short list of choices, one of them on. The first is
 * "any". A `null` between two draws a rule, as in `Select`.
 */
export function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string] | null)[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {options.map((option, index) => {
        if (option === null) return index > 0 && index < options.length - 1 ? <hr key={`rule ${index}`} className="my-1 border-t border-(--rule)" /> : null;
        const [key, text] = option;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === value}
            className="press -mx-2 flex min-h-7 cursor-pointer items-center gap-2 px-2 text-left text-sm text-muted-foreground hover:bg-(--fill) hover:text-foreground aria-checked:font-medium aria-checked:text-foreground"
            onClick={() => onChange(key)}
          >
            <span className="min-w-0 flex-1 truncate">{text}</span>
            {key === value ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
          </button>
        );
      })}
    </fieldset>
  );
}
