'use client';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** What a swipe does, said where it shows. */
export interface SwipePress {
  label: string;
  icon: ReactNode;
  onPress: () => void;
}

/** The content filling the row, the far end and the press before it scrolled out of sight. The track is what `offsetLeft` counts from. */
function rest(track: HTMLElement | null, content: HTMLElement | null, smooth = false) {
  if (track && content) track.scrollTo({ left: content.offsetLeft, behavior: smooth ? 'smooth' : 'instant' });
}
const isOpen = (track: HTMLElement | null, content: HTMLElement | null) => Math.abs((track?.scrollLeft ?? 0) - (content?.offsetLeft ?? 0)) > 1;

/** How wide a press is (`w-24`). */
const PRESS_PX = 96;

/** How near the far end, in pixels, a swipe let go of acts: it snaps there or stops short of it. */
const AT_END = 8;
/** Where `scrollend` is not sent, a swipe has ended once it has not moved for this long. */
const STILL_MS = 150;

// One row open at a time: opening another closes it.
let closeOpen: (() => void) | null = null;

/**
 * A row's content on a phone that slides sideways under the thumb, as a mail app's: a short swipe stops with a press
 * showing, `start` at its start (swiped right) and `end` at its end (swiped left), and one taken to the edge does it.
 * Built on the browser's own scrolling and snapping, so it moves as the phone's own lists do. A press on the content
 * while one shows closes it, and opens nothing. Inside a cell, it reaches over the cell's padding to the row's edges.
 */
export function Swipe({
  start,
  end,
  opened,
  children,
}: {
  start: SwipePress;
  end: SwipePress;
  /** Drawn with that press showing, as the specimen page shows each. */
  opened?: 'start' | 'end';
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const place = () => {
      rest(el, content.current);
      if (opened) el.scrollBy({ left: (opened === 'end' ? 1 : -1) * PRESS_PX, behavior: 'instant' });
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(el);
    return () => resized.disconnect();
  }, [opened]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const close = () => rest(el, content.current, true);
    let still: ReturnType<typeof setTimeout> | undefined;
    const ended = () => {
      clearTimeout(still);
      const max = el.scrollWidth - el.clientWidth;
      if (el.scrollLeft <= AT_END) {
        rest(el, content.current);
        start.onPress();
      } else if (el.scrollLeft >= max - AT_END) {
        rest(el, content.current);
        end.onPress();
      } else if (opened) {
        // Drawn open, beside others drawn open.
      } else if (isOpen(el, content.current)) {
        if (closeOpen !== close) closeOpen?.();
        closeOpen = close;
      } else if (closeOpen === close) closeOpen = null;
    };
    const scrolled = () => {
      clearTimeout(still);
      still = setTimeout(ended, STILL_MS);
    };
    const ends = 'onscrollend' in el;
    el.addEventListener(ends ? 'scrollend' : 'scroll', ends ? ended : scrolled);
    return () => {
      clearTimeout(still);
      el.removeEventListener(ends ? 'scrollend' : 'scroll', ends ? ended : scrolled);
      if (closeOpen === close) closeOpen = null;
    };
  }, [start, end, opened]);

  const press = (what: SwipePress, edge: 'start' | 'end') => (
    <button
      type="button"
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        rest(track.current, content.current);
        what.onPress();
      }}
      className={cn(
        'press flex w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 bg-foreground text-label font-semibold text-background select-none [&_svg]:size-5',
        edge === 'start' ? 'snap-start' : 'snap-end',
      )}
    >
      {what.icon}
      {what.label}
    </button>
  );

  return (
    <div
      ref={track}
      data-swipe
      className="relative -mx-(--bleed) -my-2 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* The far ends, where letting go does it: the press's colour runs on, so the row seems pulled off it. */}
      <div aria-hidden className="w-full shrink-0 snap-start bg-foreground" />
      {press(start, 'start')}
      <div
        ref={content}
        className="w-full shrink-0 snap-start snap-always px-(--bleed) py-2"
        onClickCapture={(event) => {
          if (!isOpen(track.current, content.current)) return;
          event.preventDefault();
          event.stopPropagation();
          rest(track.current, content.current, true);
        }}
      >
        {children}
      </div>
      {press(end, 'end')}
      <div aria-hidden className="w-full shrink-0 snap-end bg-foreground" />
    </div>
  );
}
