import { CheckIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button.tsx';
import { Input } from './field.tsx';

export interface ActiveFilter {
  /** What is being narrowed and to what: "Label: Newsletters". */
  label: string;
  clear: () => void;
}

/**
 * The standard way to show many of one thing: a heading with how many there are, a search box, a
 * filter button beside it, then the rows or cards. Every screen that lists something uses it.
 *
 * The filter button opens a panel on the right that pushes the list left; closing it puts the list
 * back. While closed, the button shows how many filters are on and each is listed under the search
 * box with a way to clear it, so a narrowed list never looks like the whole of it.
 */
export function ListView({
  title,
  count,
  description,
  actions,
  search,
  filters,
  children,
}: {
  title: string;
  /** How many there are, in words: "145 waiting from 11 senders". */
  count?: ReactNode;
  description?: string;
  /** What can be done to the list as a whole, such as adding to it. */
  actions?: ReactNode;
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  filters?: { panel: ReactNode; active: ActiveFilter[] };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const on = filters?.active.length ?? 0;
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="statement">{title}</span>
            {count ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
          </h2>
          {description ? <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>

      {search || filters ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {search ? (
              <label className="relative flex min-w-0 flex-1 items-center md:max-w-md">
                <SearchIcon aria-hidden className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" />
                <Input
                  type="search"
                  className="w-full pl-8"
                  aria-label={search.placeholder}
                  placeholder={search.placeholder}
                  value={search.value}
                  onChange={(event) => search.onChange(event.target.value)}
                />
              </label>
            ) : null}
            {filters ? (
              <button
                type="button"
                aria-label={on > 0 ? `Filters, ${on} on` : 'Filters'}
                aria-expanded={open}
                className={cn(
                  'press relative flex h-(--control) shrink-0 cursor-pointer items-center justify-center gap-1.5 px-2.5 text-[13px] font-medium',
                  open ? 'bg-foreground text-background' : 'bg-(--fill) hover:bg-(--fill-strong)',
                )}
                onClick={() => setOpen(!open)}
              >
                <SlidersHorizontalIcon className="size-4" />
                {on > 0 ? <span className="hl mx-0 px-1.5 py-0 text-xs tabular-nums">{on}</span> : null}
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
                    className="press flex h-6 cursor-pointer items-center gap-1 bg-(--fill) pr-1.5 pl-2 text-xs font-medium hover:bg-(--fill-strong)"
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
      <legend className="mb-1 text-[13px] font-medium">{label}</legend>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={key === value}
          className="press -mx-2 flex min-h-7 cursor-pointer items-center gap-2 px-2 text-left text-[13px] text-muted-foreground hover:bg-(--fill) hover:text-foreground aria-checked:font-medium aria-checked:text-foreground"
          onClick={() => onChange(key)}
        >
          <span className="min-w-0 flex-1 truncate">{text}</span>
          {key === value ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
        </button>
      ))}
    </fieldset>
  );
}
