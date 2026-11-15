import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One of the things sift is about, shown whole: a suggestion, a label. Cards sit in a grid and each
 * stands for one thing; rows of the same thing compared by column belong in a Table.
 *
 * A card has a head (what it is), a body, and a foot (what can be done to it), in that order.
 */
export function Card({ className, ...props }: ComponentProps<'article'>) {
  return (
    <article
      className={cn(
        'relative flex flex-col gap-3 rounded-[2px] border border-(--frame) p-4 text-sm',
        'has-[.card-open:hover]:border-foreground/35 has-[.card-open:focus-visible]:border-foreground/35',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The card's name. With `onOpen` the whole card opens it (the name is the button, stretched over the
 * card), and controls in the foot stay pressable on top.
 */
export function CardHead({ title, note, aside, onOpen }: { title: string; note?: ReactNode; aside?: ReactNode; onOpen?: () => void }) {
  return (
    <header className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            className="card-open name block max-w-full cursor-pointer truncate text-left outline-none after:absolute after:inset-0"
            onClick={onOpen}
          >
            {title}
          </button>
        ) : (
          <h3 className="name truncate">{title}</h3>
        )}
        {note ? <p className="truncate text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {aside ? <div className="shrink-0 text-sm text-muted-foreground tabular-nums">{aside}</div> : null}
    </header>
  );
}

/** What can be done to the card, along its bottom edge. Sits above the card's own press target. */
export function CardFoot({ children, className }: { children: ReactNode; className?: string }) {
  return <footer className={cn('relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-1', className)}>{children}</footer>;
}

/** Cards in columns: one on a phone, more as there is room. */
export function CardGrid({ children, min = 'md' }: { children: ReactNode; min?: 'md' | 'lg' }) {
  return <div className={cn('grid gap-3', min === 'md' ? 'md:grid-cols-2 xl:grid-cols-3' : 'lg:grid-cols-2')}>{children}</div>;
}
