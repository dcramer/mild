'use client';
import { type ReactNode, useEffect, useRef } from 'react';
import { ROOMS } from '@/lib/before-paint.ts';

/** Kept as `{ id: [width, height] }`: the window's width when the height was measured. */
function remember(id: string, height: number) {
  try {
    const rooms = JSON.parse(window.localStorage.getItem(ROOMS) ?? '{}') as Record<string, [number, number]>;
    const [width, held] = rooms[id] ?? [];
    if (width === window.innerWidth && held === height) return;
    rooms[id] = [window.innerWidth, height];
    window.localStorage.setItem(ROOMS, JSON.stringify(rooms));
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
 * server's page holds it too. Once it has filled in, in this browser, it holds the height it filled instead, kept under
 * `id` and set by the page's head before anything is drawn (`web/src/lib/before-paint.ts`): none for a part that held
 * nothing (Mild is on, so there is no "Mild is off"), and the exact height at the same width, so what is below it does
 * not move when it fills in again. `placeholder` is drawn while waiting and must fit inside the room.
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
    const keep = () => remember(id, element.getBoundingClientRect().height);
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
