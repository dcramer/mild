'use client';
import { useId } from 'react';
import { cn } from '@/lib/utils';

const GROUND = 206;

/** An envelope on legs, facing the door, its bottom-left corner at (x, y), with `heat` lines rising off it. */
function Envelope({ x, y, step, heat }: { x: number; y: number; step: number; heat: number }) {
  const top = y - 32;
  return (
    <>
      <path d={`M${x},${top} h46 v32 h-46 Z`} />
      <path d={`M${x + 1},${top + 1} L${x + 23},${top + 16} L${x + 45},${top + 1}`} strokeWidth={2.4} />
      <circle cx={x + 34} cy={top + 22} r={2.4} className="fill-current" stroke="none" />
      <circle cx={x + 41} cy={top + 22} r={2.4} className="fill-current" stroke="none" />
      <path d={`M${x + 12},${y} l${-3 - step},16 h-5 M${x + 28},${y} l${3 + step},16 h5`} strokeWidth={2.6} />
      {[x + 12, x + 23, x + 34].slice(0, heat).map((hx) => (
        <path key={hx} d={`M${hx},${top - 7} c-5,-6 5,-10 0,-17`} strokeWidth={2.4} />
      ))}
    </>
  );
}

/** An envelope let in, sat back on the ground, eyes shut, legs out in front. */
function Lounging({ x }: { x: number }) {
  const top = GROUND - 32;
  return (
    <>
      <g transform={`rotate(-20 ${x} ${GROUND})`}>
        <path d={`M${x},${top} h46 v32 h-46 Z`} />
        <path d={`M${x + 1},${top + 1} L${x + 23},${top + 16} L${x + 45},${top + 1}`} strokeWidth={2.4} />
        <path d={`M${x + 28},${top + 22} q3,3 6,0 M${x + 36},${top + 22} q3,3 6,0`} strokeWidth={2.2} />
      </g>
      <path d={`M${x + 40},${GROUND - 17} L${x + 64},${GROUND - 2} l3,-7 M${x + 34},${GROUND - 13} L${x + 56},${GROUND - 1} l3,-7`} strokeWidth={2.6} />
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

/** A point `r` from (cx, cy) at `degrees`, clockwise from three o'clock. */
const at = (cx: number, cy: number, degrees: number, r: number) => {
  const a = (degrees * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
};

/** Mild as a stove knob on the door, turned to its lowest mark: shades on, arms folded. */
function Bouncer({ cx }: { cx: number }) {
  const cy = 98;
  const r = 46;
  const [px, py] = at(cx, cy, 225, 36);
  const [qx, qy] = at(cx, cy, 225, 6);
  const mark = (degrees: number, length: number) => {
    const [x1, y1] = at(cx, cy, degrees, r + 6);
    const [x2, y2] = at(cx, cy, degrees, r + 6 + length);
    return <path d={`M${x1},${y1} L${x2},${y2}`} strokeWidth={2.6} />;
  };
  return (
    <>
      <circle cx={cx} cy={cy} r={r} />
      <path d={`M${qx},${qy} L${px},${py}`} strokeWidth={14} />
      <path d={`M${qx},${qy} L${px},${py}`} strokeWidth={8} className="stroke-background" />
      {mark(225, 10)}
      {mark(135, 6)}
      <path d={`M${cx - 26},${cy + 8} h18 v5 q-9,8 -18,0 Z M${cx + 8},${cy + 8} h18 v5 q-9,8 -18,0 Z M${cx - 8},${cy + 10} h16`} strokeWidth={2.6} />
      <path d={`M${cx - 45},${cy + 12} Q${cx - 54},${cy + 40} ${cx + 22},${cy + 38}`} />
      <path d={`M${cx + 45},${cy + 12} Q${cx + 54},${cy + 34} ${cx - 22},${cy + 32}`} />
      <path d={`M${cx - 12},${cy + r} L${cx - 16},${GROUND} h-11 M${cx + 12},${cy + r} L${cx + 16},${GROUND} h11`} />
    </>
  );
}

/**
 * Mail queued hot at a velvet rope, Mild on the door as a stove knob turned down, and the mail let in lounging past it.
 * A margin doodle (docs/brand.md): one wobbly pen in the page's ink, the rope in the highlighter. `queue` is how many
 * envelopes wait; the drawing widens with it.
 */
export function Rope({ queue = 3, className }: { queue?: number; className?: string }) {
  // useId's characters are not all allowed in a url(#…) reference.
  const id = useId().replace(/[^\w-]/g, '');
  const rope = 12 + queue * 60 + 30;
  const door = rope + 160;
  const width = door + 230;
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
          // The one nearest the door has started to cool.
          <Envelope key={i} x={12 + i * 60} y={[190, 188, 190, 189][i % 4]} step={i % 2 ? 1 : -1} heat={i === queue - 1 ? 2 : 3} />
        ))}
        <Post x={rope} />
        <Post x={rope + 70} />
        <path d={`M${rope},148 Q${rope + 35},180 ${rope + 70},148`} strokeWidth={7} className="stroke-highlight" />
        <Bouncer cx={door} />
        <Lounging x={door + 70} />
        <Lounging x={door + 150} />
      </g>
    </svg>
  );
}
