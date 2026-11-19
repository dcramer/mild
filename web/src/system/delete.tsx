'use client';
import { type ReactNode, useState } from 'react';
import { Button } from './button.tsx';
import { Dialog } from './dialog.tsx';
import { Field, Form, Input } from './field.tsx';
import { Failure } from './note.tsx';

/**
 * Every press that deletes what nothing brings back: a rule, a label, a sign-in, a mailbox, the account. Its words
 * in red, or down a list a quiet trash can, and either opens the same question: what goes, what else goes with it,
 * and the red press that does it. Where it takes the record of someone's mail with it, they type `typed` first.
 */
export function DeleteButton({
  children,
  action = children,
  question,
  what,
  typed,
  icon,
  disabled,
  why,
  onDelete,
  says,
}: {
  /** The press: "Remove", "Delete account". The press that does it says the same, unless `action` says more. */
  children: string;
  action?: string;
  /** The dialog's title: "Remove this rule?" */
  question: string;
  /** What is deleted, under the question, when the question does not name it. */
  what?: ReactNode;
  /** What else goes that the reader could not tell. */
  says?: ReactNode;
  /** What to type before it can be done. */
  typed?: string;
  /** Down a list, the press is this icon alone, quiet like the row's other actions. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Why it cannot be pressed now, with `disabled`. */
  why?: string;
  /** Settles once it is done, which closes the question; a failure is shown under it. */
  onDelete: () => Promise<unknown>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const ready = typed === undefined || text.trim() === typed;
  const close = () => {
    setAsking(false);
    setError(null);
    setText('');
  };
  const go = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    onDelete().then(
      () => {
        setBusy(false);
        close();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  const press = icon ? (
    // Named by the question, so each row's trash can says whose it is.
    <Button
      variant="quiet"
      size="icon"
      aria-label={question.replace(/\?$/, '')}
      disabled={disabled ?? false}
      {...(why ? { why } : {})}
      onClick={() => setAsking(true)}
    >
      {icon}
    </Button>
  ) : (
    <Button variant="danger" disabled={disabled ?? false} {...(why ? { why } : {})} onClick={() => setAsking(true)}>
      {`${children}…`}
    </Button>
  );
  return (
    <>
      {press}
      {asking ? (
        <Dialog
          open
          onClose={close}
          title={question}
          {...(what ? { subtitle: what } : {})}
          footer={
            <>
              {/* With nothing to type, the press has the focus, so a keyboard user deletes with Enter, as they asked to. */}
              <Button variant="destroy" autoFocus={typed === undefined} busy={busy} disabled={!ready} onClick={go}>
                {action}
              </Button>
              <Button variant="quiet" onClick={close}>
                Cancel
              </Button>
              <Failure>{error}</Failure>
            </>
          }
        >
          {says || typed !== undefined ? (
            <Form onSubmit={go}>
              {says ? <p className="text-base">{says}</p> : null}
              {typed === undefined ? null : (
                <Field label={`Type ${typed} to confirm`}>
                  <Input aria-label={`Type ${typed} to confirm`} autoFocus autoComplete="off" value={text} onChange={(event) => setText(event.target.value)} />
                </Field>
              )}
            </Form>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
