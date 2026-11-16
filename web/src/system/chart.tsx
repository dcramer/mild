import { useState } from 'react';

export interface Series {
  key: string;
  name: string;
  /** A CSS colour. Series are drawn bottom to top in the order given. */
  color: string;
}

export interface ChartRow {
  key: string;
  /** Under the column. */
  label: string;
  /** In the readout, when the column is pointed at. */
  title: string;
  values: Record<string, number>;
}

/** The next round number at or above `n`, so the scale ends on a figure worth reading. */
function ceiling(n: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(n, 1)));
  return ([1, 2, 5, 10].find((step) => step * power >= n) ?? 10) * power;
}

/** A series' or a tier's colour, always beside its name. */
export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-[1px] ring-1 ring-foreground/20" style={{ background: color }} />;
}

/**
 * Counts over time, stacked by series. `compact` for a chart beside figures rather than one of its own. The line above the columns is the legend until a column is
 * pointed at or focused, then it reads out that column.
 */
export function StackedBars({ series, rows, unit, compact }: { series: readonly Series[]; rows: readonly ChartRow[]; unit: string; compact?: boolean }) {
  const [at, setAt] = useState<number | null>(null);
  const total = (row: ChartRow) => series.reduce((sum, s) => sum + (row.values[s.key] ?? 0), 0);
  const max = ceiling(Math.max(...rows.map(total), 1));
  const shown = at === null ? undefined : rows[at];
  const every = Math.ceil(rows.length / 8);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground tabular-nums">
        {shown ? <span className="font-medium text-foreground">{shown.title}</span> : null}
        {series
          .filter((s) => !shown || (shown.values[s.key] ?? 0) > 0)
          .map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Swatch color={s.color} />
              {s.name}
              {shown ? <span className="text-foreground">{shown.values[s.key]}</span> : null}
            </span>
          ))}
        {shown && total(shown) === 0 ? <span>No {unit}</span> : null}
      </p>

      <div className={`relative ml-8 ${compact ? 'h-28' : 'h-52'}`}>
        {[1, 0.5, 0].map((share) => (
          <div key={share} className="absolute inset-x-0 border-t border-dashed border-(--rule)" style={{ bottom: `${share * 100}%` }}>
            <span className="absolute right-full -translate-y-1/2 pr-2 text-[13px] text-muted-foreground tabular-nums">{Math.round(max * share)}</span>
          </div>
        ))}
        <ol className="relative flex h-full items-stretch" onMouseLeave={() => setAt(null)}>
          {rows.map((row, index) => {
            const drawn = series.filter((s) => (row.values[s.key] ?? 0) > 0);
            return (
              <li
                key={row.key}
                tabIndex={0}
                aria-label={`${row.title}: ${total(row)} ${unit}`}
                className="flex min-w-0 flex-1 flex-col-reverse items-center gap-0.5 px-px hover:bg-(--fill) focus-visible:bg-(--fill)"
                onMouseEnter={() => setAt(index)}
                onFocus={() => setAt(index)}
                onBlur={() => setAt(null)}
              >
                {drawn.map((s, position) => (
                  <span
                    key={s.key}
                    className={`w-full max-w-7 ${position === drawn.length - 1 ? 'rounded-t-[3px]' : ''}`}
                    style={{ height: `${((row.values[s.key] ?? 0) / max) * 100}%`, minHeight: 2, background: s.color }}
                  />
                ))}
              </li>
            );
          })}
        </ol>
      </div>

      <ol aria-hidden className="ml-8 flex text-[13px] text-muted-foreground">
        {rows.map((row, index) => (
          <li key={row.key} className="min-w-0 flex-1 text-center whitespace-nowrap">
            {index % every === 0 ? row.label : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}
