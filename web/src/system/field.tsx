import { type ComponentProps, type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

/** Somewhere to type is outlined and empty, like the search bar; something to press is filled. The outline darkens in use. */
const FIELD =
  'border border-(--frame) bg-transparent placeholder:text-muted-foreground/70 hover:border-foreground/30 focus:border-foreground/45 disabled:opacity-45';

/** A line of text typed by the reader. Inside a `Field` it takes the field's label; on its own give it an `aria-label`. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('field focus-within-shown h-(--control) min-w-0 rounded-(--corner) px-3 text-base', FIELD, className)} {...props} />;
}

/** Longer text. */
export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn('block min-h-48 w-full resize-y rounded-(--corner) px-3 py-2.5 text-base leading-relaxed', FIELD, 'focus-within-shown', className)}
      {...props}
    />
  );
}

/** A yes or no, with its label beside it. */
export function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground has-checked:text-foreground">
      <input type="checkbox" className="size-3.5 accent-foreground" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

/**
 * One question in a form: its label, the control or controls that answer it, then what follows from the
 * answer (`hint`) and what is wrong with it (`error`). `inline` puts the label beside the controls on a
 * wide screen, for a short form in a narrow column. A form is a column of these with the action last.
 */
export function Field({
  label,
  hint,
  error,
  inline,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  inline?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={cn('flex flex-col gap-1.5', inline && 'sm:grid sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-x-4')}>
      <span id={id} className={cn('text-sm font-semibold', inline && 'sm:flex sm:h-(--control) sm:items-center sm:text-muted-foreground')}>
        {label}
      </span>
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <div className="flex w-full flex-wrap items-center gap-2">{children}</div>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

/**
 * A part of a long form under its own name, for a form a reader would otherwise read as one column of
 * questions: a rule's which mail, what it is and what happens. A rule above each part after the first.
 */
export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-(--rule) pt-5 first:border-t-0 first:pt-0">
      <h3 className="name text-base">{title}</h3>
      {children}
    </section>
  );
}

/** A form's questions, one under another, with what finishes it last. */
export function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}
