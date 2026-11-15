import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A stroke of highlighter. It means "look here", so a screen has few of them. */
export function Highlight({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('hl', className)}>{children}</span>;
}

/** The name, always highlighted. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={cn('wordmark', size === 'lg' && 'text-[34px]')}>
      <span className="hl mx-0 px-[0.35em] py-[0.08em]">sift</span>
    </span>
  );
}

/** `text` with every occurrence of `term` highlighted, as a search result would be marked by hand. */
export function Marked({ text, term }: { text: string; term?: string }) {
  const needle = term?.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: ReactNode[] = [];
  const haystack = text.toLowerCase();
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="hl mx-0 px-0.5">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** Something typed or pasted: a command, an address, a setting. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-[2px] bg-foreground/8 px-[0.35em] py-[0.1em] font-mono text-[0.9em]">{children}</code>;
}

/** A rubber stamp: a short verdict. Weight carries the meaning, from outline to solid ink; `look` is for what is left to the reader. */
export function Stamp({ tone = 'outline', children }: { tone?: 'outline' | 'tint' | 'ink' | 'look'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'stamp',
        tone === 'outline' && 'border border-foreground/30',
        tone === 'tint' && 'bg-secondary text-secondary-foreground',
        tone === 'ink' && 'bg-foreground text-background',
        tone === 'look' && 'bg-highlight text-highlight-ink',
      )}
    >
      {children}
    </span>
  );
}
