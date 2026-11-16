import { useState } from 'react';

interface Series {
  key: string;
  name: string;
  /** A CSS colour. Series are drawn bottom to top in the order given. */
  color: string;
}

interface ChartRow {
  key: string;
  /** Under the column. */
  label: string;
  /** In the readout, when the column is pointed at. */
  title: string;
  values: Record<string, number>;
}

/** A series' or a tier's colour, always beside its name. */
export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-[1px] ring-1 ring-foreground/20" style={{ background: color }} />;
}

/** The next round number at or above `n`, under 1 too, so a scale ends on a figure worth reading. */
function ceiling(n: number): number {
  if (n <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 5, 10].find((step) => step * power >= n) ?? 10) * power;
}

/** A second measure over the columns, as a line on the right-hand axis: model cost over mail handled. */
interface Line {
  name: string;
  /** One value per row, in the same order. */
  values: readonly number[];
  format: (value: number) => string;
  /** For the right-hand axis, where a figure may need more precision than in the tooltip. */
  tick: (value: number) => string;
}

/**
 * Counts over time, stacked by series, on the left axis; `line` adds a second measure on its own right
 * axis. Both start at zero and share their gridlines. No legend: pointing at or focusing a column opens a
 * tooltip with that day's figures (none that are zero), the segment under the pointer first in weight.
 */
export function StackedBars({ series, rows, line, compact }: { series: readonly Series[]; rows: readonly ChartRow[]; line?: Line; compact?: boolean }) {
  const [at, setAt] = useState<number | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  const total = (row: ChartRow) => series.reduce((sum, s) => sum + (row.values[s.key] ?? 0), 0);
  const max = ceiling(Math.max(...rows.map(total), 1));
  const lineMax = line ? ceiling(Math.max(...line.values, 0)) : 1;
  const shown = at === null ? undefined : rows[at];
  const every = Math.ceil(rows.length / 6);
  const x = (index: number) => ((index + 0.5) / rows.length) * 100;
  const y = (n: number) => 100 - (n / lineMax) * 100;
  const points = line?.values.map((n, index) => `${x(index)},${y(n)}`).join(' ');
  const gutters = line ? 'mr-12 ml-10' : 'ml-10';
  const leave = () => {
    setAt(null);
    setUnder(null);
  };

  return (
    <div className="flex flex-col gap-2" onMouseLeave={leave}>
      <div className={`relative ${gutters} ${compact ? 'h-28' : 'h-44'}`}>
        {[1, 0.5, 0].map((share) => (
          <div key={share} className="absolute inset-x-0 border-t border-(--rule)" style={{ bottom: `${share * 100}%` }}>
            <span className="absolute right-full -translate-y-1/2 pr-2 text-label text-muted-foreground tabular-nums">
              {Number.isInteger(max * share) ? (max * share).toLocaleString() : ''}
            </span>
            {line ? (
              <span className="absolute left-full -translate-y-1/2 pl-2 text-label whitespace-nowrap text-muted-foreground tabular-nums">
                {line.tick(lineMax * share)}
              </span>
            ) : null}
          </div>
        ))}
        <ol className="relative flex h-full items-stretch">
          {rows.map((row, index) => {
            const drawn = series.filter((s) => (row.values[s.key] ?? 0) > 0);
            return (
              <li
                key={row.key}
                tabIndex={0}
                aria-label={`${row.title}: ${series.map((s) => `${row.values[s.key] ?? 0} ${s.name.toLowerCase()}`).join(', ')}${line ? `, ${line.format(line.values[index] ?? 0)} ${line.name.toLowerCase()}` : ''}`}
                className={`flex min-w-0 flex-1 flex-col-reverse items-center gap-0.5 px-px outline-none ${at === index ? 'bg-(--fill)' : ''}`}
                onMouseEnter={() => setAt(index)}
                onFocus={() => setAt(index)}
                onBlur={leave}
              >
                {drawn.map((s, position) => (
                  <span
                    key={s.key}
                    className={`w-full max-w-6 ${position === drawn.length - 1 ? 'rounded-t-[4px]' : ''}`}
                    style={{ height: `${((row.values[s.key] ?? 0) / max) * 100}%`, minHeight: 2, background: s.color }}
                    onMouseEnter={() => setUnder(s.key)}
                    onMouseLeave={() => setUnder(null)}
                  />
                ))}
              </li>
            );
          })}
        </ol>
        {line && points ? (
          <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            {/* Drawn twice: a stroke of the page under the ink keeps the line apart from the columns it crosses. */}
            <polyline points={points} fill="none" stroke="var(--background)" strokeWidth={5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <polyline points={points} fill="none" stroke="var(--foreground)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
        {line && at !== null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
            style={{ left: `${x(at)}%`, bottom: `${100 - y(line.values[at] ?? 0)}%` }}
          />
        ) : null}
        {shown && at !== null ? (
          <div
            aria-hidden
            className="sheet pointer-events-none absolute top-0 z-10 flex w-max flex-col gap-1 bg-popover px-3 py-2 text-sm tabular-nums"
            style={
              at < rows.length / 2
                ? { left: `calc(${((at + 1) / rows.length) * 100}% + 8px)` }
                : { right: `calc(${((rows.length - at) / rows.length) * 100}% + 8px)` }
            }
          >
            <p className="font-medium">{shown.title}</p>
            {series
              .toReversed()
              .filter((s) => (shown.values[s.key] ?? 0) > 0)
              .map((s) => (
                <p key={s.key} className={`flex items-center gap-2 ${under === null || under === s.key ? '' : 'text-muted-foreground'}`}>
                  <Swatch color={s.color} />
                  <span className={under === s.key ? 'font-medium' : ''}>{s.name}</span>
                  <span className="ml-auto pl-4">{(shown.values[s.key] ?? 0).toLocaleString()}</span>
                </p>
              ))}
            {line ? (
              <p className={`flex items-center gap-2 ${under === null ? '' : 'text-muted-foreground'}`}>
                <span className="h-0.5 w-2.5 rounded-full bg-foreground" />
                <span>{line.name}</span>
                <span className="ml-auto pl-4">{line.format(line.values[at] ?? 0)}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <ol aria-hidden className={`${gutters} flex text-label text-muted-foreground`}>
        {rows.map((row, index) => (
          <li key={row.key} className="min-w-0 flex-1 text-center whitespace-nowrap">
            {index % every === 0 ? row.label : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}
