import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const FILL = 'bg-(--fill) placeholder:text-muted-foreground/70 hover:bg-(--fill-strong) focus:bg-(--fill-strong) disabled:opacity-45';

/** A line of text typed by the reader. Always give it an `aria-label` or a visible label. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('field h-(--control) min-w-0 rounded-(--cut-control) px-3 text-[13px]', FILL, className)} {...props} />;
}

/** Longer text. */
export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('block min-h-48 w-full resize-y rounded-[2px] px-3 py-2.5 text-[13px] leading-relaxed', FILL, className)} {...props} />;
}

/** A switch between two states of a view, with its label. */
export function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
      <input type="checkbox" className="size-3.5 accent-foreground" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}
