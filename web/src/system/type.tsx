import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A stroke of highlighter. It means "look here", so a screen has few of them. */
export function Highlight({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('hl', className)}>{children}</span>;
}

/** The name, always highlighted. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={cn('wordmark', size === 'lg' && 'large')}>
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

/**
 * A rubber stamp: a short verdict in a word, from the fixed vocabulary in `lib/format.ts` (what sift does,
 * where a sender stands). All stamps weigh the same, so the word carries the meaning; `look` is only for
 * what is left to the reader.
 */
export function Stamp({ tone = 'plain', children }: { tone?: 'plain' | 'look'; children: ReactNode }) {
  return <span className={cn('stamp', tone === 'look' ? 'bg-highlight text-highlight-ink' : 'border border-foreground/30')}>{children}</span>;
}

/** A link inside text or a cell: underlined, so it reads as one without colour. */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={cn('underline decoration-foreground/35 underline-offset-[0.2em] hover:decoration-foreground', className)}>
      {children}
    </a>
  );
}

/** A key on the keyboard, where it works: beside the button it presses, or in a hint. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('font-mono text-label font-normal text-muted-foreground', className)}>{children}</kbd>;
}

/** A word in yellow ink for what is left to the reader, inside a line ("Not sure"). Like every yellow, few on a screen. */
export function Look({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-highlight">{children}</span>;
}
