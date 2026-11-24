'use client';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils.ts';

/** What a swipe does, said where it shows. */
export interface SwipePress {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  /** It takes the row out of the list (Archive): swiped to the edge, the row closes up first, as a mail app's does. */
  leaves?: boolean;
}

/** The content filling the row, the far end and the press before it scrolled out of sight. The track is what `offsetLeft` counts from. */
function rest(track: HTMLElement | null, content: HTMLElement | null, smooth = false) {
  if (!track || !content) return;
  // Where rest is, so a scroll that only puts the row back there is not taken for the list moving (`Tr`'s hold).
  track.dataset.rest = String(content.offsetLeft);
  track.scrollTo({ left: content.offsetLeft, behavior: smooth ? 'smooth' : 'instant' });
}
const isOpen = (track: HTMLElement | null, content: HTMLElement | null) => Math.abs((track?.scrollLeft ?? 0) - (content?.offsetLeft ?? 0)) > 1;

/** How wide a press is (`w-24`). */
const PRESS_PX = 96;

/** How near the far end, in pixels, a swipe let go of acts: it snaps there or stops short of it. */
const AT_END = 8;
/** Where `scrollend` is not sent, a swipe has ended once it has not moved for this long. */
const STILL_MS = 150;
/** How long a row swiped away takes to close up. */
const CLOSE_MS = 180;
/** A row closed up that its list has not taken away by then (the press failed) opens again. */
const GIVE_BACK_MS = 1000;

/**
 * Closes up the row `track` is in, its press's colour still across it: the track's height and every cell's padding to
 * nothing, then `done`, which takes the row away.
 */
function closeRow(track: HTMLElement, done: () => void) {
  const timing = { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : CLOSE_MS, easing: 'ease-in', fill: 'forwards' } as const;
  const own = getComputedStyle(track);
  const runs = [
    track.animate(
      [
        { height: `${track.offsetHeight}px`, marginTop: own.marginTop, marginBottom: own.marginBottom },
        { height: '0px', marginTop: '0px', marginBottom: '0px' },
      ],
      timing,
    ),
  ];
  for (const cell of track.closest('tr')?.cells ?? []) {
    const padding = getComputedStyle(cell);
    runs.push(
      cell.animate(
        [
          { paddingTop: padding.paddingTop, paddingBottom: padding.paddingBottom },
          { paddingTop: '0px', paddingBottom: '0px' },
        ],
        timing,
      ),
    );
  }
  void runs[0].finished.then(() => {
    done();
    setTimeout(() => {
      if (track.isConnected) for (const run of runs) run.cancel();
    }, GIVE_BACK_MS);
  });
}

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
    // A swipe acts once, as soon as it is at the edge with the finger off: not after the snap there has settled.
    let touching = false;
    let acted = false;
    const act = (what: SwipePress) => {
      acted = true;
      if (what.leaves) return closeRow(el, what.onPress);
      rest(el, content.current);
      what.onPress();
    };
    const atEdge = () => {
      if (touching || acted) return false;
      const max = el.scrollWidth - el.clientWidth;
      if (el.scrollLeft <= AT_END) act(start);
      else if (el.scrollLeft >= max - AT_END) act(end);
      else return false;
      return true;
    };
    const ended = () => {
      clearTimeout(still);
      if (atEdge() || acted) return;
      if (opened) {
        // Drawn open, beside others drawn open.
      } else if (isOpen(el, content.current)) {
        if (closeOpen !== close) closeOpen?.();
        closeOpen = close;
      } else if (closeOpen === close) closeOpen = null;
    };
    const scrolled = () => {
      clearTimeout(still);
      // Back at rest, the next swipe acts again (a trackpad's, which no touch begins).
      if (!isOpen(el, content.current)) acted = false;
      if (!atEdge() && !('onscrollend' in el)) still = setTimeout(ended, STILL_MS);
    };
    const down = () => {
      touching = true;
      acted = false;
    };
    const up = () => {
      touching = false;
      atEdge();
    };
    el.addEventListener('scroll', scrolled, { passive: true });
    el.addEventListener('scrollend', ended);
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      clearTimeout(still);
      el.removeEventListener('scroll', scrolled);
      el.removeEventListener('scrollend', ended);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
      if (closeOpen === close) closeOpen = null;
    };
  }, [start, end, opened]);

  const press = (what: SwipePress, edge: 'start' | 'end') => (
    <button
      type="button"
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        if (what.leaves && track.current) return closeRow(track.current, what.onPress);
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
