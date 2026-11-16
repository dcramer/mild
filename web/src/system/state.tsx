import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';
import { Table, Tr } from './table.tsx';

/** What a sheet says when it has nothing to show. One plain sentence; say what would put something here if that is not obvious. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-(--gutter) py-6 text-muted-foreground">{children}</p>;
}

const LINES = ['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5'];
const WORDS = ['w-16', 'w-12', 'w-20', 'w-14'];

/**
 * Text that is on its way. It sits in the line its text will take, at the size of the type around it,
 * so a `name`, a `Sub` or a heading keeps its height and nothing moves when the text arrives. `word` for
 * something short (an action, a time, a count); otherwise it fills a share of its cell. `className` sizes
 * it to stand for something that is not text, such as a control.
 */
export function Blank({ word, className }: { word?: boolean; className?: string }) {
  // Its length comes from where it is on the page, so blanks vary down a list and stay put as it redraws.
  const id = useId();
  let at = 0;
  for (let index = 0; index < id.length; index++) at = (at * 31 + id.charCodeAt(index)) >>> 0;
  const lengths = word ? WORDS : LINES;
  return (
    <span
      aria-hidden
      className={cn(
        // A line tall wherever it sits, inline or in a flex row, with the bar drawn across its middle.
        'inline-block h-[1lh] max-w-full animate-pulse bg-(--fill-strong) bg-clip-content py-[calc((1lh-0.75em)/2)] align-top motion-reduce:animate-none',
        lengths[at % lengths.length],
        className,
      )}
    />
  );
}

/**
 * Stands in for rows that are on their way. Given `children`, they are one row's cells, set like the real
 * row's (the same `Td`s, with a `Blank` for each piece of text), and the table repeats them. Without, lines
 * of text, for what is not a list.
 */
export function Loading({ rows = 6, children }: { rows?: number; children?: ReactNode }) {
  const each = Array.from({ length: rows }, (_, index) => index);
  if (!children)
    return (
      <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-1 px-(--gutter) py-4">
        {each.map((index) => (
          <Blank key={index} />
        ))}
      </div>
    );
  return (
    <div aria-busy="true" aria-label="Loading">
      <Table>
        <tbody aria-hidden>
          {each.map((index) => (
            <Tr key={index}>{children}</Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
