/**
 * How a figure moved over the days behind it, as one line of ink with no axis: its shape, not values to read
 * off. `from` and `to` name the first and last day under its ends. Beside the figures it trends, never alone.
 */
export function Spark({ values, from, to }: { values: readonly number[]; from: string; to: string }) {
  const top = Math.max(...values, 0) || 1;
  const last = Math.max(values.length - 1, 1);
  const points = values.map((value, index) => `${(index / last) * 100},${100 - (value / top) * 100}`).join(' ');
  return (
    <div>
      <svg aria-hidden viewBox="-1 -6 102 112" preserveAspectRatio="none" className="block h-10 w-full">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-1 flex justify-between text-label text-muted-foreground">
        <span>{from}</span>
        <span>{to}</span>
      </p>
    </div>
  );
}
