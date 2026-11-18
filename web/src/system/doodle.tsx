'use client';
import { useId } from 'react';
import { cn } from '@/lib/utils';

const GROUND = 206;

/** An envelope on legs, facing the door, its bottom-left corner at (x, y). */
function Envelope({ x, y, step }: { x: number; y: number; step: number }) {
  const top = y - 32;
  return (
    <>
      <path d={`M${x},${top} h46 v32 h-46 Z`} />
      <path d={`M${x + 1},${top + 1} L${x + 23},${top + 16} L${x + 45},${top + 1}`} strokeWidth={2.4} />
      <circle cx={x + 34} cy={top + 22} r={2.4} className="fill-current" stroke="none" />
      <circle cx={x + 41} cy={top + 22} r={2.4} className="fill-current" stroke="none" />
      <path d={`M${x + 12},${y} l${-3 - step},16 h-5 M${x + 28},${y} l${3 + step},16 h5`} strokeWidth={2.6} />
    </>
  );
}

function Post({ x }: { x: number }) {
  return (
    <>
      <path d={`M${x},${GROUND} V140 M${x - 12},${GROUND} q12,-6 24,0`} />
      <circle cx={x} cy={133} r={6.5} />
    </>
  );
}

/** Sift as a sieve on the door: shades on, arms folded. */
function Bouncer({ cx, mesh }: { cx: number; mesh: string }) {
  const cy = 104;
  const bowl = `M${cx - 40},${cy} A40,48 0 0 0 ${cx + 40},${cy}`;
  const hatch = Array.from({ length: 13 }, (_, i) => {
    const x = cx + (i - 6) * 10;
    return `M${x - 30},${cy + 40} l40,48 M${x + 30},${cy + 40} l-40,48`;
  }).join(' ');
  return (
    <>
      <clipPath id={mesh}>
        <path d={`${bowl} Z`} transform="translate(0 2)" />
      </clipPath>
      <path d={hatch} clipPath={`url(#${mesh})`} strokeWidth={1.4} opacity={0.45} />
      <path d={bowl} />
      <path d={`M${cx - 40},${cy} a40,8 0 1 0 80,0 a40,8 0 1 0 -80,0`} />
      <path d={`M${cx + 38},${cy - 2} L${cx + 74},${cy - 12} a5,5 0 1 1 3,9 L${cx + 40},${cy + 4}`} />
      <path d={`M${cx - 26},${cy + 12} h18 v5 q-9,8 -18,0 Z M${cx + 8},${cy + 12} h18 v5 q-9,8 -18,0 Z M${cx - 8},${cy + 14} h16`} strokeWidth={2.6} />
      <path d={`M${cx - 21},${cy + 14} l5,-1 M${cx + 13},${cy + 14} l5,-1`} strokeWidth={1.8} />
      <path d={`M${cx - 39},${cy + 10} Q${cx - 40},${cy + 34} ${cx + 22},${cy + 36}`} />
      <path d={`M${cx + 39},${cy + 10} Q${cx + 40},${cy + 30} ${cx - 22},${cy + 32}`} />
      <path d={`M${cx - 12},${cy + 46} L${cx - 16},${GROUND} h-11 M${cx + 12},${cy + 46} L${cx + 16},${GROUND} h11`} />
    </>
  );
}

/**
 * Mail queued at a velvet rope, Sift on the door. A margin doodle (docs/brand.md): one wobbly pen in the
 * page's ink, the rope in the highlighter. `queue` is how many envelopes wait; the drawing widens with it.
 */
export function Rope({ queue = 3, className }: { queue?: number; className?: string }) {
  // useId's characters are not all allowed in a url(#…) reference.
  const id = useId().replace(/[^\w-]/g, '');
  const rope = 12 + queue * 60 + 54;
  const door = rope + 146;
  const width = door + 88;
  return (
    <svg
      viewBox={`0 0 ${width} 230`}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-auto w-full text-foreground', className)}
    >
      <filter id={`${id}-wobble`} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={4} />
        <feDisplacementMap in="SourceGraphic" scale={3.2} />
      </filter>
      <g filter={`url(#${id}-wobble)`}>
        <path d={`M10,${GROUND} H${width - 10}`} strokeWidth={2.4} />
        {Array.from({ length: queue }, (_, i) => (
          <Envelope key={i} x={12 + i * 60} y={[190, 188, 190, 189][i % 4]} step={i % 2 ? 1 : -1} />
        ))}
        <Post x={rope} />
        <Post x={rope + 70} />
        <path d={`M${rope},148 Q${rope + 35},180 ${rope + 70},148`} strokeWidth={7} className="stroke-highlight" />
        <Bouncer cx={door} mesh={`${id}-mesh`} />
      </g>
    </svg>
  );
}
