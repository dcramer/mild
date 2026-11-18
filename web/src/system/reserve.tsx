import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';

/** The cookie naming each `Reserve` that held nothing the last time it filled in, in this browser. */
const COOKIE = 'sift_empty';

/**
 * The parts that were empty last time, as this request's cookie names them. The server reads it as the browser does,
 * so both hold the same room. Given once, where the page starts.
 */
export const EmptyBefore = createContext<readonly string[]>([]);

/** The ids a `Cookie` header, or `document.cookie`, names as empty last time. */
export const emptyIn = (cookies: string): string[] => {
  const value = cookies.match(/(?:^|; )sift_empty=([^;]*)/)?.[1];
  return value ? decodeURIComponent(value).split(',').filter(Boolean) : [];
};

function remember(id: string, empty: boolean) {
  const kept = new Set(emptyIn(document.cookie));
  if (kept.has(id) === empty) return;
  if (empty) kept.add(id);
  else kept.delete(id);
  // Only ids: whether a part had anything to show is all the server learns.
  document.cookie = `${COOKIE}=${encodeURIComponent([...kept].join(','))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * Holds the room a part will take while what fills it is on its way, so nothing below it moves when it
 * arrives. Use it for anything above other content whose height depends on what loads: figures, a
 * chart, a notice that may or may not be there.
 *
 * `room` is its usual height on a narrow and on a wide screen, as classes (`min-h-[386px] lg:min-h-[206px]`), so the
 * server holds it too. A part that held nothing the last time it filled in, in this browser, holds no room (Sift is on,
 * so there is no "Sift is off"); that is kept, under `id`, in a cookie the server reads. `placeholder` is drawn while
 * waiting and must fit inside the room.
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
  const before = useContext(EmptyBefore);
  const [wasEmpty] = useState(() => before.includes(id));

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
    <div ref={ref} aria-busy={!ready} className={ready || wasEmpty ? undefined : room}>
      {ready ? children : placeholder}
    </div>
  );
}
