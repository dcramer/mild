import { type ComponentProps, type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useShortcut } from './keys.tsx';

const BASE =
  'press inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 border border-transparent font-semibold whitespace-nowrap select-none aria-disabled:pointer-events-none aria-disabled:opacity-45 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[1.15em] [&_svg]:shrink-0';

const VARIANT = {
  /** The one thing on the screen that is waiting on the reader. At most one per screen, and never repeated down a list. */
  mark: 'bg-highlight font-semibold text-highlight-ink hover:brightness-105',
  /** What finishes a dialog or a form, and the choice that is on in a group. Never repeated down a list. */
  ink: 'bg-foreground font-semibold text-background hover:bg-foreground/85',
  /** A page's own action (adding to its list), and everything else that is not repeated. */
  plain: 'bg-(--fill) hover:bg-(--fill-strong)',
  /** Actions that repeat down a list (they firm up when their row is pointed at), and ways out. */
  quiet: 'text-foreground/75 hover:bg-(--fill) hover:text-foreground group-hover/row:bg-(--fill-strong) group-hover/row:text-foreground',
} as const;

/** `md` everywhere a control sits in a row or a toolbar; `lg` for the one action a screen is about; `icon` for an icon alone, with an `aria-label`. */
const SIZE = {
  md: 'h-(--control) px-3 text-sm',
  icon: 'size-(--control) text-sm',
  lg: 'h-12 px-5 text-base',
} as const;

interface Own {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  /** Waiting on something this press started. Stops further presses. */
  busy?: boolean;
  /**
   * The key that presses this, drawn beside its label. A string when the button's label is plain text;
   * otherwise the key with a few words for the list of all keys. Inside a table row it is live, and
   * shown, only on the row the reader is on.
   */
  shortcut?: string | { key: string; label: string };
  children: ReactNode;
}

type Props = Own & (({ href: string } & Omit<ComponentProps<'a'>, 'children'>) | ({ href?: undefined } & Omit<ComponentProps<'button'>, 'children'>));

/** Something you press. Given `href` it is a link that looks the same. */
export function Button({ variant = 'plain', size = 'md', busy = false, shortcut, className, children, ...rest }: Props) {
  const classes = cn(BASE, VARIANT[variant], SIZE[size], busy && 'pointer-events-none', className);
  const element = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const key = typeof shortcut === 'string' ? shortcut : shortcut?.key;
  const hint = useShortcut(
    key,
    typeof shortcut === 'object' ? shortcut.label : typeof children === 'string' ? children : '',
    () => element.current?.click(),
    variant === 'mark' || variant === 'ink' ? { tone: 'ink' as const } : {},
  );
  const content = (
    <>
      {children}
      {hint}
      {busy ? <span aria-hidden className="busy-dots" /> : null}
    </>
  );
  if (rest.href !== undefined) {
    return (
      <a ref={element} className={classes} aria-busy={busy || undefined} {...(key ? { 'aria-keyshortcuts': key } : {})} {...rest}>
        {content}
      </a>
    );
  }
  const { type = 'button', disabled, ...button } = rest;
  return (
    <button
      ref={element}
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...(key ? { 'aria-keyshortcuts': key } : {})}
      {...button}
    >
      {content}
    </button>
  );
}
