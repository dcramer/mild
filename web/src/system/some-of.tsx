'use client';
import { useState } from 'react';

/** How many a folded list names before "and N more". */
const SHOWN = 3;

const PRESS =
  'cursor-pointer underline decoration-foreground/35 underline-offset-[0.2em] hover:decoration-foreground focus-visible:decoration-foreground pointer-coarse:-my-3 pointer-coarse:py-3';

/**
 * Items said in a line, "a, b, c and 38 more", so a long list (everyone a message went to) never pushes what
 * follows off the screen. "38 more" says the whole list where it stands, and "Fewer", after it, folds it again.
 * One more than `shown` is said in full: "and 1 more" takes as much room as the item.
 */
export function SomeOf({ items, shown = SHOWN }: { items: readonly string[]; shown?: number }) {
  const [open, setOpen] = useState(false);
  if (items.length <= shown + 1) return <>{items.join(', ')}</>;
  if (open)
    return (
      <>
        {items.join(', ')}{' '}
        <button type="button" aria-expanded className={PRESS} onClick={() => setOpen(false)}>
          Fewer
        </button>
      </>
    );
  return (
    <>
      {items.slice(0, shown).join(', ')} and{' '}
      <button type="button" aria-expanded={false} className={PRESS} onClick={() => setOpen(true)}>
        {items.length - shown} more
      </button>
    </>
  );
}
