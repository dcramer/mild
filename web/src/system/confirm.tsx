import { type ReactNode, useState } from 'react';
import { Button } from './button.tsx';

/**
 * A press that cannot be taken back. The first press asks, in place, with the question and the same
 * words on the button that does it; Cancel or Escape puts it back. The answer has the focus, so a
 * keyboard user confirms with Enter.
 */
export function ConfirmButton({
  question,
  onConfirm,
  variant = 'quiet',
  busy,
  disabled,
  children,
}: {
  /** Says what will be lost: "Remove this rule?" */
  question: string;
  onConfirm: () => void;
  /** How the first press looks: `quiet` down a list, `plain` on its own. */
  variant?: 'quiet' | 'plain';
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button variant={variant} busy={busy ?? false} disabled={disabled ?? false} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  return (
    <span role="group" aria-label={question} className="inline-flex items-center gap-1.5" onKeyDown={(event) => event.key === 'Escape' && setAsking(false)}>
      <span className="mr-1 text-sm whitespace-nowrap">{question}</span>
      <Button
        variant="ink"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {children}
      </Button>
      <Button variant="quiet" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
