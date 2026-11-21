'use client';
import { type KeyboardEvent, useState } from 'react';
import { Button } from './button.tsx';

/**
 * A press that is hard to take back but deletes nothing (turning Mild on); deleting is `DeleteButton`. The first
 * press asks, in place, with the question and the same words on the button that does it; Cancel or Escape puts it
 * back. The answer has the focus, so a keyboard user confirms with Enter.
 */
export function ConfirmButton({
  question,
  onConfirm,
  variant = 'quiet',
  busy,
  disabled,
  children,
}: {
  /** Says what will happen: "Turn Mild on?" */
  question: string;
  onConfirm: () => void;
  /** How the first press looks: `quiet` down a list, `plain` on its own. */
  variant?: 'quiet' | 'plain';
  busy?: boolean;
  disabled?: boolean;
  children: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button variant={variant} busy={busy ?? false} disabled={disabled ?? false} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  const escape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    // The Escape is this question's alone, not the panel or dialog it sits in.
    event.stopPropagation();
    setAsking(false);
  };
  return (
    <span role="group" aria-label={question} className="inline-flex items-center gap-1.5">
      <span className="mr-1 text-sm whitespace-nowrap">{question}</span>
      <Button
        variant="ink"
        autoFocus
        onKeyDown={escape}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {children}
      </Button>
      <Button variant="quiet" onKeyDown={escape} onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
