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
  return (
    <Ask
      question={question}
      onYes={() => {
        setAsking(false);
        onConfirm();
      }}
      onNo={() => setAsking(false)}
    >
      {children}
    </Ask>
  );
}

/**
 * A question asked in place of the press that raised it: the question, the press that goes ahead (its words those of
 * the press asked about, and focused, so Enter answers yes), and Cancel. Escape is Cancel. `ConfirmButton` asks it on
 * its first press; the composer asks one only when what is written needs it (no subject).
 */
export function Ask({ question, onYes, onNo, children }: { question: string; onYes: () => void; onNo: () => void; children: string }) {
  const escape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    // The Escape is this question's alone, not the panel or dialog it sits in.
    event.stopPropagation();
    onNo();
  };
  return (
    <span role="group" aria-label={question} className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm">{question}</span>
      <Button variant="ink" autoFocus onKeyDown={escape} onClick={onYes}>
        {children}
      </Button>
      <Button variant="quiet" onKeyDown={escape} onClick={onNo}>
        Cancel
      </Button>
    </span>
  );
}
