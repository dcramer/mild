'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Taller than any message; a frame told more is being fed its own height back. */
const TALLEST = 40_000;
/** How long after its document has loaded a frame that has not said its height gets one of its own. */
const UNTOLD_MS = 2_000;

interface Told {
  height: number;
  blocked: boolean;
}

/** What the frame's own script (`FRAME_SCRIPT`, src/dashboard/frame-script.ts) says, or null for anything else. */
function told(data: unknown): Told | null {
  if (typeof data !== 'object' || data === null) return null;
  const { sift, height, blocked } = data as Record<string, unknown>;
  if (sift !== 'mail-frame' || typeof height !== 'number' || !Number.isFinite(height) || typeof blocked !== 'boolean') return null;
  return { height: Math.min(Math.max(Math.ceil(height), 0), TALLEST), blocked };
}

/**
 * A message as its own HTML, read as part of the page: the frame is as tall as the message, so the page scrolls as one,
 * and the document in it is a letter in the dashboard's ink or a design on its white paper (`mailDocument`,
 * src/dashboard/mail-html.ts). It runs nothing of the mail's and loads nothing from elsewhere; links open in a new tab.
 * Hidden until it has said how tall it is, so nothing jumps or flashes white; one that never says scrolls inside,
 * 70% of the screen tall. `onBlocked` is told when the message asked for images from elsewhere, which it did not get.
 */
export function MailFrame({ src, title, onBlocked }: { src?: string | undefined; title: string; onBlocked?: (() => void) | undefined }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [untold, setUntold] = useState(false);
  const [shown, setShown] = useState(src);
  if (shown !== src) {
    setShown(src);
    setHeight(null);
    setUntold(false);
  }
  const heardBlocked = useEffectEvent(() => onBlocked?.());
  useEffect(() => {
    const heard = (event: MessageEvent) => {
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      const said = told(event.data);
      if (!said) return;
      setHeight(said.height);
      if (said.blocked) heardBlocked();
    };
    window.addEventListener('message', heard);
    return () => window.removeEventListener('message', heard);
  }, []);
  const sized = height !== null;
  // A frame whose script never answered (a browser that refused it) still shows its message.
  useEffect(() => {
    const node = frame.current;
    if (sized || !node) return;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const loaded = () => {
      clearTimeout(wait);
      wait = setTimeout(() => setUntold(true), UNTOLD_MS);
    };
    node.addEventListener('load', loaded);
    return () => {
      node.removeEventListener('load', loaded);
      clearTimeout(wait);
    };
  }, [sized]);
  const fallback = untold && !sized;
  return (
    <div className={cn(fallback ? 'h-[70svh] min-h-64 bg-(--paper)' : sized ? undefined : 'h-24')}>
      <iframe
        ref={frame}
        src={src}
        title={title}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        className={cn('block w-full', fallback ? 'h-full' : sized ? undefined : 'invisible h-full')}
        style={sized ? { height } : undefined}
      />
    </div>
  );
}
