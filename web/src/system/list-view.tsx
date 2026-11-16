import { CheckIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { type ReactNode, useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button.tsx';
import { useShortcut } from './keys.tsx';
import { PageHeader } from './page.tsx';

export interface ActiveFilter {
  /** What is being narrowed and to what: "Label: Newsletters". */
  label: string;
  clear: () => void;
}

/**
 * The standard way to show many of one thing: the page header (with how many there are), then `intro`
 * (anything the page shows before its list), then one outlined bar holding the search and the filter
 * button, then the rows. Every screen that lists something uses it.
 *
 * The filter button opens a panel on the right that pushes the list left; closing it puts the list
 * back. While closed, the button shows how many filters are on and each is listed under the search
 * box with a way to clear it, so a narrowed list never looks like the whole of it.
 */
export function ListView({
  title,
  actions,
  intro,
  search,
  view,
  filters,
  children,
}: {
  title: string;
  /** What can be done to the list as a whole, such as adding to it. */
  actions?: ReactNode;
  /** What the page shows between its header and its list. */
  intro?: ReactNode;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  /** Which of a few ways to see the list, as segments at the end of the search bar: "Changed" or "Everything". */
  view?: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void };
  filters?: { panel: ReactNode; active: ActiveFilter[] };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const slash = useShortcut('/', 'Search', () => searchBox.current?.focus(), { enabled: search !== undefined });
  const on = filters?.active.length ?? 0;
  return (
    <section className="flex flex-col gap-6">
      <PageHeader title={title} actions={actions} />
      {intro}

      <div className="flex flex-col gap-3">
        {search || filters || view ? (
          <div className="flex flex-col gap-2">
            {/* One bar: the search and the filters share an outline, and nothing is filled until it is used. */}
            <div className="flex h-9 items-stretch rounded-(--cut-control) border border-(--frame) transition-colors focus-within:border-foreground/45">
              {search ? (
                <label className="flex min-w-0 flex-1 items-center gap-2.5 px-3">
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
                <span className="flex-1" />
              )}
              {view ? (
                <div role="radiogroup" aria-label={view.label} className="flex shrink-0 border-l border-(--frame)">
                  {view.options.map(([key, text]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={key === view.value}
                      className="cursor-pointer px-3 text-sm font-medium text-muted-foreground hover:bg-(--fill) hover:text-foreground aria-checked:bg-(--fill-strong) aria-checked:text-foreground"
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
                    'flex shrink-0 cursor-pointer items-center gap-2 border-l border-(--frame) px-3 text-sm font-semibold',
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
            <aside aria-label="Filters" className="flex flex-col gap-5 md:order-2 md:border-l md:border-dashed md:border-(--rule) md:pl-4">
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
    </section>
  );
}

/** One thing a list can be narrowed by, in the filter panel: a short list of choices, one of them on. The first is "any". */
export function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {options.map(([key, text]) => (
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
      ))}
    </fieldset>
  );
}
