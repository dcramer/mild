'use client';
import { Trash2Icon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from './button.tsx';
import { TextArea } from './field.tsx';
import { Tooltip } from './tooltip.tsx';

/**
 * Mail being written in place at the foot of a conversation (Reply, Reply all, Forward), framed as one thing: `about`
 * says which message it answers when that is not the newest, then its `DraftLine`s, its `DraftText`, and Send and
 * `DiscardButton` (`actions`) along its foot. It brings itself into view as it opens, under however much conversation
 * is above it.
 */
export function ReplyBox({ label, about, actions, children }: { label: string; about?: ReactNode; actions: ReactNode; children: ReactNode }) {
  const own = useRef<HTMLElement>(null);
  // Braced: a browser may answer a scroll with a promise, which React would take for the effect's cleanup.
  useEffect(() => {
    own.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <section ref={own} aria-label={label} className="sheet mt-2 flex scroll-mb-6 flex-col">
      {about ? <p className="px-(--gutter) pt-3 text-sm text-muted-foreground">{about}</p> : null}
      {children}
      <div className="flex items-center gap-2 px-3 pt-1 pb-3">{actions}</div>
    </section>
  );
}

/**
 * One of a draft's lines above its text (From, To, Cc, Subject): its name in quiet ink, firm while it is typed in, then
 * its control (an `Input bare`, or a `Select`), then whatever adds a line (Cc). What is wrong with it under them. A
 * dashed rule under each.
 */
export function DraftLine({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="row group/line flex flex-col px-(--gutter) py-1">
      <div className="flex min-h-(--control) items-center gap-3">
        <span id={id} className="w-14 shrink-0 text-sm text-muted-foreground group-focus-within/line:text-foreground">
          {label}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      </div>
      {error ? <p className="pb-1.5 pl-[4.25rem] text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/** What is being written, under its lines: at reading size with no outline of its own, since the draft's frame or panel is its edge. */
export function DraftText(props: Omit<ComponentProps<typeof TextArea>, 'bare'>) {
  return <TextArea bare {...props} />;
}

/**
 * Drops what is being written: a quiet trash can at the end of a draft's presses. Not a `DeleteButton`: the toast it
 * leaves has Undo, which brings the draft back.
 */
export function DiscardButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip says="Discard" className="ml-auto">
      <Button variant="quiet" size="icon" aria-label="Discard" onClick={onClick}>
        <Trash2Icon aria-hidden />
      </Button>
    </Tooltip>
  );
}

/**
 * In a draft's place, what has to be allowed before it can be written (Google letting Sift send from a mailbox): what
 * is missing, as a name, and one line on how it is put right. The press that does it goes with the draft's actions.
 */
export function DraftBlocked({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-(--gutter) pt-4 pb-3">
      <h3 className="name">{title}</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
