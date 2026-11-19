'use client';
import { CheckIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { type ReactNode, useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button.tsx';
import { useShortcut } from './keys.tsx';

interface ActiveFilter {
  /** What is being narrowed and to what: "Label: Newsletters". */
  label: string;
  clear: () => void;
}

/**
 * The standard way to show many of one thing, inside a `ListPage`: `intro` (anything the page shows before its
 * list), then one outlined bar holding the search and the filter button, then the rows. While rows are selected
 * (`RowCheck`), the bar holds what to do with them in place of the search (`selected`): how many, the presses, and a
 * way to select none, so the rows do not move.
 *
 * The filter button opens a panel on the right that pushes the list left; closing it puts the list
 * back. While closed, the button shows how many filters are on and each is listed under the search
 * box with a way to clear it, so a narrowed list never looks like the whole of it.
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
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  /** Which of a few ways to see the list, as segments at the end of the search bar: "Changed" or "Everything". */
  view?: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void };
  filters?: { panel: ReactNode; active: ActiveFilter[] };
  /** Rows selected, and what can be done to all of them, each with its key. */
  selected?: { count: number; clear: () => void; actions: readonly { label: string; key: string; onPress: () => void }[] };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const slash = useShortcut('/', 'Search', () => searchBox.current?.focus(), { enabled: search !== undefined && !(selected && selected.count > 0) });
  const on = filters?.active.length ?? 0;
  return (
    <>
      {intro}

      <div className="flex flex-col gap-3">
        {search || filters || view ? (
          <div className="flex flex-col gap-2">
            {/* One bar: the search and the filters share an outline, and nothing is filled until it is used. On a phone the view takes a row of its own under the search. */}
            <div className="flex flex-wrap items-stretch rounded-(--corner) border border-(--frame) transition-colors focus-within:border-foreground/45 md:flex-nowrap">
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
                    onKeyDown={(event) => event.key === 'Escape' && event.currentTarget.blur()}
                  />
                  {slash}
                </label>
              ) : (
                <span className="h-9 flex-1" />
              )}
              {view ? (
                <div
                  role="radiogroup"
                  aria-label={view.label}
                  className="order-last flex h-9 w-full border-t border-(--frame) md:order-none md:w-auto md:shrink-0 md:border-t-0 md:border-l"
                >
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
            {on > 0 && !open ? (
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
        ) : null}

        <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-4', open && 'md:grid-cols-[minmax(0,1fr)_15rem]')}>
          <div className="flex min-w-0 flex-col gap-3 md:order-1">{children}</div>
          {open && filters ? (
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
