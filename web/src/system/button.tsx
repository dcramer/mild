import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const BASE =
  'press inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 border border-transparent font-semibold whitespace-nowrap select-none aria-disabled:pointer-events-none aria-disabled:opacity-45 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[1.15em] [&_svg]:shrink-0';

const VARIANT = {
  /** The one thing on the screen that is waiting on the reader. At most one per screen. */
  mark: 'press-raised bg-highlight text-highlight-ink',
  /** The main action of a sheet or a row. */
  ink: 'bg-foreground text-background hover:bg-foreground/85',
  /** Everything else. */
  plain: 'bg-(--fill) hover:bg-(--fill-strong)',
  /** Actions that repeat down a list, and ways out. */
  quiet: 'text-muted-foreground hover:bg-(--fill) hover:text-foreground',
} as const;

const SIZE = {
  sm: 'h-7 px-2.5 text-[13px]',
  md: 'h-[34px] px-3.5 text-sm',
  lg: 'h-12 px-5 text-base',
} as const;

interface Own {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  /** Waiting on something this press started. Stops further presses. */
  busy?: boolean;
  children: ReactNode;
}

type Props = Own & (({ href: string } & Omit<ComponentProps<'a'>, 'children'>) | ({ href?: undefined } & Omit<ComponentProps<'button'>, 'children'>));

/** Something you press. Given `href` it is a link that looks the same. */
export function Button({ variant = 'plain', size = 'md', busy = false, className, children, ...rest }: Props) {
  const classes = cn(BASE, VARIANT[variant], SIZE[size], busy && 'pointer-events-none', className);
  const content = (
    <>
      {children}
      {busy ? <span aria-hidden className="busy-dots" /> : null}
    </>
  );
  if (rest.href !== undefined) {
    return (
      <a className={classes} aria-busy={busy || undefined} {...rest}>
        {content}
      </a>
    );
  }
  const { type = 'button', disabled, ...button } = rest;
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...button}>
      {content}
    </button>
  );
}
