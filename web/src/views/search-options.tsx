import { SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Alternatives for the list view's search box, to choose between. Temporary: the chosen one goes into
 * `ListView` and this file is deleted. Each is a working field so focus and typing can be tried.
 */

function Frame({ letter, name, why, children }: { letter: string; name: string; why: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-dashed border-(--rule) pt-6">
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="slug text-muted-foreground">Option {letter}</span>
        <span className="font-semibold">{name}</span>
        <span className="text-[13px] text-muted-foreground">{why}</span>
      </p>
      <div className="flex flex-col gap-4">
        <h3 className="flex items-baseline gap-3">
          <span className="statement">Rules</span>
          <span className="text-muted-foreground tabular-nums">7</span>
        </h3>
        {children}
        <p className="border-b border-dashed border-(--rule) pb-2">
          <span className="slug text-muted-foreground">When mail is</span>
        </p>
      </div>
    </section>
  );
}

function useField() {
  const [value, setValue] = useState('');
  return { value, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value), clear: () => setValue('') };
}

const INPUT = 'focus-within-shown min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground';

/** Today: a filled box with hand-cut corners, and a filled square beside it. */
function Current() {
  const field = useField();
  return (
    <div className="flex items-center gap-2">
      <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-(--cut-control) bg-(--fill) px-3 focus-within:bg-(--fill-strong) md:max-w-md">
        <SearchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <input className={cn(INPUT, 'text-[13px]')} placeholder="Search senders, domains and labels" value={field.value} onChange={field.onChange} />
      </label>
      <button type="button" aria-label="Filters" className="press flex size-8 items-center justify-center bg-(--fill) hover:bg-(--fill-strong)">
        <SlidersHorizontalIcon className="size-4" />
      </button>
    </div>
  );
}

/** A. No box at all: a ruled line to write on, like a form. The line turns to highlighter while it is in use. */
function Underline() {
  const field = useField();
  return (
    <div className="flex items-end gap-5">
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2.5 border-b border-(--frame) transition-colors focus-within:border-highlight md:max-w-lg">
        <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input className={INPUT} placeholder="Search senders, domains and labels" value={field.value} onChange={field.onChange} />
        {field.value ? (
          <button type="button" aria-label="Clear" className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={field.clear}>
            <XIcon className="size-4" />
          </button>
        ) : null}
      </label>
      <button
        type="button"
        className="flex h-9 cursor-pointer items-center gap-2 border-b border-transparent text-sm text-muted-foreground hover:text-foreground"
      >
        <SlidersHorizontalIcon aria-hidden className="size-4" />
        Filters
        <span className="hl mx-0 px-1.5 py-0 text-xs tabular-nums">2</span>
      </button>
    </div>
  );
}

/** B. One framed control: search and filters share an outline and read as a single bar across the list. */
function Joined() {
  const field = useField();
  return (
    <div className="flex h-10 items-stretch rounded-[2px] border border-(--frame) transition-colors focus-within:border-foreground/50">
      <label className="flex min-w-0 flex-1 items-center gap-2.5 px-3">
        <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input className={INPUT} placeholder="Search senders, domains and labels" value={field.value} onChange={field.onChange} />
        <kbd className="hidden rounded-[2px] border border-(--frame) px-1.5 font-mono text-[11px] text-muted-foreground md:block">/</kbd>
      </label>
      <button type="button" className="flex cursor-pointer items-center gap-2 border-l border-(--frame) px-3.5 text-sm font-medium hover:bg-(--fill)">
        <SlidersHorizontalIcon aria-hidden className="size-4" />
        Filters
        <span className="hl mx-0 px-1.5 py-0 text-xs tabular-nums">2</span>
      </button>
    </div>
  );
}

/** C. Out of the way: two quiet icons on the title's line. Search opens into a field in place when asked for. */
function Collapsed() {
  const field = useField();
  const [open, setOpen] = useState(false);
  return (
    <div className="-mt-13 flex h-9 items-center justify-end gap-1">
      {open ? (
        <label className="flex h-9 w-full max-w-sm items-center gap-2.5 border-b border-highlight">
          <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            className={INPUT}
            placeholder="Search senders, domains and labels"
            value={field.value}
            onChange={field.onChange}
            onBlur={() => field.value === '' && setOpen(false)}
          />
          <button
            type="button"
            aria-label="Close search"
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => {
              field.clear();
              setOpen(false);
            }}
          >
            <XIcon className="size-4" />
          </button>
        </label>
      ) : (
        <button
          type="button"
          aria-label="Search"
          className="press flex size-9 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground"
          onClick={() => setOpen(true)}
        >
          <SearchIcon className="size-4" />
        </button>
      )}
      <button
        type="button"
        aria-label="Filters, 2 on"
        className="press relative flex size-9 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground"
      >
        <SlidersHorizontalIcon className="size-4" />
        <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-highlight" />
      </button>
    </div>
  );
}

/** D. The search is the heading's second line: large type, no box, so the screen reads "Rules: find one". */
function Typeset() {
  const field = useField();
  return (
    <div className="flex items-center gap-4">
      <label className="flex min-w-0 flex-1 items-center gap-3">
        <SearchIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <input
          className="focus-within-shown min-w-0 flex-1 bg-transparent text-xl font-medium tracking-tight caret-(--highlight) placeholder:font-normal placeholder:text-muted-foreground/70"
          placeholder="Find a sender, a domain or a label"
          value={field.value}
          onChange={field.onChange}
        />
      </label>
      <button
        type="button"
        className="press flex h-8 cursor-pointer items-center gap-2 px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-(--fill) hover:text-foreground"
      >
        <SlidersHorizontalIcon aria-hidden className="size-4" />
        Filters
        <span className="hl mx-0 px-1.5 py-0 text-xs tabular-nums">2</span>
      </button>
    </div>
  );
}

export function SearchOptions() {
  return (
    <div className="flex flex-col gap-8">
      <Frame letter="now" name="Filled box" why="What the list view has today.">
        <Current />
      </Frame>
      <Frame letter="A" name="Ruled line" why="No box. A line to write on that turns to highlighter in use; filters are a word beside it.">
        <Underline />
      </Frame>
      <Frame letter="B" name="One framed bar" why="Search and filters share one outline across the list, with a / shortcut.">
        <Joined />
      </Frame>
      <Frame letter="C" name="Tucked away" why="Two quiet icons on the title's line; search opens in place when asked for.">
        <Collapsed />
      </Frame>
      <Frame letter="D" name="Typeset" why="Search as large type under the title, no box at all.">
        <Typeset />
      </Frame>
    </div>
  );
}
