'use client';
import { type ReactNode, useState } from 'react';
import { Button } from './button.tsx';

/**
 * The history a reply quotes under it, folded behind •••, as a message's HTML folds it in its frame. Opened, it reads
 * in quiet ink beside a rule.
 */
export function Quoted({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="quiet"
        className="-ml-2 h-auto px-2 tracking-widest"
        aria-expanded={open}
        aria-label={open ? 'Hide the quoted text' : 'Show the quoted text'}
        onClick={() => setOpen(!open)}
      >
        •••
      </Button>
      {open ? <div className="border-l-2 border-border pl-4 text-muted-foreground">{children}</div> : null}
    </div>
  );
}
