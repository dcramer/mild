import { type ReactNode, useEffect, useRef, useState } from 'react';

const WIDE = '(min-width: 64rem)';
const band = () => (typeof window !== 'undefined' && window.matchMedia(WIDE).matches ? 'wide' : 'narrow');

function remembered(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Holds the room a part will take while what fills it is on its way, so nothing below it moves when it
 * arrives. Use it for anything above other content whose height depends on what loads: figures, a
 * chart, a notice that may or may not be there.
 *
 * The room held is the height this part last had in this browser, at this width; before that, `room`,
 * which should be the usual height on a narrow and on a wide screen. Only a number is kept, under `id`.
 * `placeholder` is drawn while waiting and must fit inside the room.
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
  room: { narrow: number; wide: number };
  placeholder?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [key] = useState(() => `sift:room:${id}:${band()}`);
  const [held] = useState(() => remembered(key) ?? room[band()]);

  useEffect(() => {
    const element = ref.current;
    if (!ready || !element) return;
    const keep = () => {
      try {
        window.localStorage.setItem(key, String(Math.round(element.offsetHeight)));
      } catch {
        // Storage is a convenience: without it the next visit holds the usual room.
      }
    };
    keep();
    const observer = new ResizeObserver(keep);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready, key]);

  return (
    <div ref={ref} aria-busy={!ready} style={ready ? undefined : { minHeight: held }}>
      {ready ? children : placeholder}
    </div>
  );
}
