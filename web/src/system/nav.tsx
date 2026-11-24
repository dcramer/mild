'use client';
import { Dialog } from '@base-ui/react/dialog';
import { MenuIcon, SquarePenIcon, XIcon } from 'lucide-react';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { handOver, useBackCloses } from '@/lib/params.ts';
import { Anchor } from './anchor.tsx';
import { Button } from './button.tsx';
import { Cloud, FinePrint } from './fine-print.tsx';
import { AboveToasts } from './toast.tsx';
import { type MailboxChoice, MailboxSwitch } from './mailbox.tsx';
import { Avatar, type MenuItem } from './menu.tsx';
import type { NavItem } from './rail.tsx';
import { Wordmark } from './type.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * The phone's top bar's own room, where a list puts its search: given by what draws the bar (the dashboard), `null` until
 * the bar is drawn. Without one (`undefined`), a list keeps its search on the page.
 */
export const BarSlot = createContext<HTMLElement | null | undefined>(undefined);

/** Draws `children` in the phone's top bar, while there is one: a list's search, in place of the name. */
export function ToBar({ children }: { children: ReactNode }) {
  const at = useContext(BarSlot);
  return at ? createPortal(children, at) : null;
}

/**
 * Whether the bar is out of the way: going down the page, past its top, until the reader scrolls back up. It keeps
 * `--bar` at the bar's height while it shows and at the status bar's while it does not, so what sticks under it (a
 * day's heading) follows it.
 */
function useAway(): [boolean, (bar: HTMLElement | null) => void] {
  const [away, setAway] = useState(false);
  const [bar, setBar] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let last = window.scrollY;
    const moved = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 6) return;
      setAway(y > last && y > 120);
      last = y;
    };
    window.addEventListener('scroll', moved, { passive: true });
    return () => window.removeEventListener('scroll', moved);
  }, []);
  useEffect(() => {
    if (!bar) return;
    const root = document.documentElement.style;
    const measured = new ResizeObserver(() => root.setProperty('--bar', away ? 'var(--safe-top)' : `${bar.offsetHeight}px`));
    measured.observe(bar, { box: 'border-box' });
    return () => {
      measured.disconnect();
      root.removeProperty('--bar');
    };
  }, [bar, away]);
  return [away, setBar];
}

/** How far in from the left edge a swipe that opens the menu starts: nearer than a row's own swipe would. */
const EDGE = 24;

/**
 * A swipe in from the left edge, as a phone's mail app opens its menu, while nothing else is open over the page. In a
 * browser tab the system takes that edge for Back first, so the menu keeps a press of its own.
 */
function useEdgeSwipe(on: boolean, onSwipe: (open: true) => void) {
  useEffect(() => {
    if (!on) return;
    let from: { x: number; y: number } | null = null;
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      from =
        event.touches.length === 1 && touch && touch.clientX <= EDGE && !document.querySelector('[role="dialog"]')
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!from || !touch) return;
      const across = touch.clientX - from.x;
      if (Math.abs(touch.clientY - from.y) > across) {
        from = null;
        return;
      }
      // The row under the thumb would scroll sideways too.
      event.preventDefault();
      if (across > 40) {
        from = null;
        onSwipe(true);
      }
    };
    const end = () => {
      from = null;
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, [on, onSwipe]);
}

const ICON_PRESS = 'press flex size-11 shrink-0 cursor-pointer items-center justify-center';

/**
 * The top of every screen on a phone, where `Rail` is not shown: the menu button, then a list's search (`ToBar`), outlined,
 * or the page's name; the sections themselves are the `TabBar`. `aside` (Mild's line) is in the menu, not the bar.
 * The menu is a panel that covers the screen, opened by its button or a swipe in from the left edge: the sections followed by `FinePrint` as a list,
 * with `detail` (what `aside`'s hover card says, which a touch screen never shows) framed above the account, and the
 * `mailbox` the dashboard shows under whose they are. Back closes it; where a press in it goes takes its place in history.
 */
export function Masthead({
  items,
  current,
  aside,
  detail,
  mailbox,
  account,
  slot,
}: {
  slot?: (element: HTMLDivElement | null) => void;
  items: readonly NavItem[];
  current: string;
  aside?: ReactNode;
  detail?: ReactNode;
  mailbox?: MailboxChoice | undefined;
  account?: { name: string; items: readonly MenuItem[] } | undefined;
}) {
  const [open, setOpen] = useState(false);
  useBackCloses(open, () => setOpen(false));
  const leave = () => {
    handOver();
    setOpen(false);
  };
  // Going somewhere closes the panel.
  const [shownAt, setShownAt] = useState(current);
  if (shownAt !== current) {
    setShownAt(current);
    setOpen(false);
  }
  const cloud = useContext(Cloud);
  const [away, measure] = useAway();
  useEdgeSwipe(items.length > 0, setOpen);
  const here = items.find((item) => item.to === current);

  // No sections: the page before it knows who is signed in, which may yet be the sign-in page, so the name alone.
  if (items.length === 0)
    return (
      <header className="flex items-center pt-[calc(1rem+var(--safe-top))] pb-6 md:hidden">
        {/* As tall as the row the menu button makes, so the name stays put as it arrives. */}
        <Anchor href="/" aria-label="Mild" className="flex min-h-11 items-center">
          <Wordmark />
        </Anchor>
      </header>
    );

  return (
    // One outlined field across the top, the menu at its start; on a list it is the list's search, and elsewhere the name.
    // It gets out of the way going down the page, and comes back going up.
    <header
      ref={measure}
      className={cn(
        'sticky top-0 z-20 -mx-4 bg-background px-4 pt-[calc(1rem+var(--safe-top))] pb-2 transition-[translate] duration-200 motion-reduce:transition-none md:hidden',
        away && '-translate-y-full',
      )}
    >
      <Dialog.Root open={open} onOpenChange={setOpen}>
        {/* Outlined only around a search: elsewhere it is the page's name. */}
        <div className="flex h-12 items-center rounded-(--corner) border border-(--frame) transition-colors focus-within:border-foreground/45 has-[[data-bar-slot]:empty]:border-transparent">
          <Dialog.Trigger aria-label="Menu" className={`${ICON_PRESS} [html:has([data-searching])_&]:hidden`}>
            <MenuIcon className="size-5" />
          </Dialog.Trigger>
          <Dialog.Portal>
            {/* From the left, as the edge swipe that opens it. */}
            <Dialog.Popup className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background pt-[calc(1rem+var(--safe-top))] pr-[max(1rem,var(--safe-right))] pb-[calc(2rem+var(--safe-bottom))] pl-[max(1rem,var(--safe-left))] outline-none transition-transform duration-200 ease-out data-ending-style:pointer-events-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full motion-reduce:transition-none md:hidden">
              <div className="flex items-center justify-between">
                <Wordmark />
                <Dialog.Title className="sr-only">Menu</Dialog.Title>
                <Dialog.Close aria-label="Close menu" className={`${ICON_PRESS} -mr-2`}>
                  <XIcon className="size-5" />
                </Dialog.Close>
              </div>
              <nav aria-label="Sections" className="mt-6">
                <ul className="flex flex-col gap-1">
                  {items.map((item) => (
                    <li key={item.to}>
                      <Anchor
                        href={`/${item.to}`}
                        aria-current={item.to === current ? 'page' : undefined}
                        className="statement flex min-h-12 items-center gap-3 text-muted-foreground aria-[current=page]:text-foreground"
                        replace
                        onClick={leave}
                      >
                        <span>{item.label}</span>
                        {item.count ? <span className="text-base font-medium tabular-nums">{item.count}</span> : null}
                      </Anchor>
                    </li>
                  ))}
                </ul>
              </nav>
              {cloud ? (
                <div className="mt-8">
                  <FinePrint list />
                </div>
              ) : null}
              {aside || detail ? (
                <div className="sheet mt-auto flex flex-col gap-4 p-4 text-sm">
                  {aside ? <div className="text-muted-foreground">{aside}</div> : null}
                  {detail}
                </div>
              ) : null}
              {account ? (
                <div className={`${aside || detail ? 'mt-6' : 'mt-auto'} flex flex-col gap-4 border-t border-(--rule) pt-5`}>
                  <p className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Avatar name={account.name} />
                    <span className="min-w-0 break-all">{account.name}</span>
                  </p>
                  {mailbox ? (
                    <MailboxSwitch
                      {...mailbox}
                      onChange={(chosen) => {
                        setOpen(false);
                        mailbox.onChange(chosen);
                      }}
                    />
                  ) : null}
                  <div className="grid auto-cols-fr grid-flow-col gap-2">
                    {account.items.map((item) => (
                      <Button
                        key={item.label}
                        disabled={item.disabled}
                        {...(item.note ? { why: item.note } : {})}
                        className="justify-center"
                        onClick={() => {
                          leave();
                          item.onSelect();
                        }}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </Dialog.Popup>
          </Dialog.Portal>
          <div ref={slot} data-bar-slot className="peer flex min-w-0 flex-1 items-center self-stretch empty:hidden" />
          {here ? (
            <p aria-hidden className="name flex min-h-11 flex-1 items-center text-base peer-[:not(:empty)]:hidden">
              {here.label}
            </p>
          ) : (
            <Anchor href={`/${items[0]?.to ?? ''}`} aria-label="Mild" className="flex min-h-11 items-center peer-[:not(:empty)]:hidden">
              <Wordmark />
            </Anchor>
          )}
        </div>
      </Dialog.Root>
    </header>
  );
}

/**
 * The sections along the bottom of a phone, where the thumb is: each its icon over its name, the current one's icon on a
 * fill as the rail's is, and a count on the icon's corner; `compose` in the middle, its icon in ink, as the rail has it at
 * its top. Nothing floats over the list, so a toast sits on the bar with nothing to move. The menu (`Masthead`) still
 * holds everything, the sections among it. It holds its own height at the end of the page, so nothing ends under it; a
 * `ThumbBar` covers it while it shows.
 */
export function TabBar({ items, current, compose }: { items: readonly NavItem[]; current: string; compose?: (() => void) | undefined }) {
  if (items.length === 0) return null;
  const middle = Math.floor(items.length / 2);
  return (
    <>
      <div aria-hidden className="h-[calc(4rem+var(--safe-bottom))] md:hidden [html:has([data-searching])_&]:hidden" />
      <AboveToasts className="fixed inset-x-0 bottom-0 z-20 bg-rail pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left) md:hidden [html:has([data-searching])_&]:hidden">
        <nav aria-label="Sections" className="grid h-16 auto-cols-fr grid-flow-col">
          {items.map(({ to, label, icon: Icon, count }, index) => [
            index === middle && compose ? (
              <button
                key="compose"
                type="button"
                onClick={compose}
                className="flex cursor-pointer flex-col items-center justify-center gap-1 text-label font-medium text-foreground select-none"
              >
                <span className="flex h-8 w-14 items-center justify-center rounded-[8px] bg-foreground text-background active:bg-foreground/80">
                  <SquarePenIcon aria-hidden className="size-5" strokeWidth={2} />
                </span>
                <span>Compose</span>
              </button>
            ) : null,
            <Anchor
              key={to}
              href={`/${to}`}
              aria-current={to === current ? 'page' : undefined}
              className="group flex flex-col items-center justify-center gap-1 text-label font-medium text-muted-foreground select-none aria-[current=page]:text-foreground"
              replace
            >
              <span className="relative flex h-8 w-14 items-center justify-center rounded-[8px] group-aria-[current=page]:bg-(--fill-strong)">
                <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                {count ? (
                  <span
                    aria-hidden
                    className="absolute -top-1 right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-foreground px-1 text-label leading-none font-semibold text-background tabular-nums"
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null}
              </span>
              <span>{label}</span>
              {count ? <span className="sr-only">{count}</span> : null}
            </Anchor>,
          ])}
        </nav>
      </AboveToasts>
    </>
  );
}
