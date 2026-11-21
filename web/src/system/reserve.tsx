'use client';
import { type ReactNode, useEffect, useRef } from 'react';
import { EMPTY } from '@/lib/before-paint.ts';

function remember(id: string, empty: boolean) {
  try {
    const kept = new Set((window.localStorage.getItem(EMPTY) ?? '').split(',').filter(Boolean));
    if (kept.has(id) === empty) return;
    if (empty) kept.add(id);
    else kept.delete(id);
    window.localStorage.setItem(EMPTY, [...kept].join(','));
  } catch {
    // Storage is a convenience: without it the next visit holds the usual room.
  }
}

/**
 * Holds the room a part will take while what fills it is on its way, so nothing below it moves when it
 * arrives. Use it for anything above other content whose height depends on what loads: figures, a
 * chart, a notice that may or may not be there.
 *
 * `room` is its usual height on a narrow and on a wide screen, as classes (`min-h-[386px] lg:min-h-[206px]`), so the
 * server's page holds it too. A part that held nothing the last time it filled in, in this browser, holds no room (Mild
 * is on, so there is no "Mild is off"): that is kept under `id`, and the page's head lets it go before anything is
 * drawn (`web/src/lib/before-paint.ts`). `placeholder` is drawn while waiting and must fit inside the room.
 */
export function Reserve({
  id,
  ready,
  room,
  placeholder,
  children,
}: {
  id: string;
  ready: boolean;
  room: string;
  placeholder?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!ready || !element) return;
    const keep = () => remember(id, element.offsetHeight === 0);
    keep();
    const observer = new ResizeObserver(keep);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, id]);

  return (
    <div ref={ref} data-room={id} aria-busy={!ready} className={ready ? undefined : room}>
      {ready ? children : placeholder}
    </div>
  );
}
