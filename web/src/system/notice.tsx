import type { ReactNode } from 'react';

/**
 * A state of sift itself, true on every screen, so it goes in the masthead: sift cannot be reached, a
 * sign-in has expired. `look` is for one the reader has to do something about, with `href` and `action`
 * for where; plain ink with a pulse is for one that mends itself. News about one page is a `Note`.
 */
export function Notice({ tone = 'plain', href, action, children }: { tone?: 'plain' | 'look'; href?: string; action?: string; children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm font-medium whitespace-nowrap text-foreground">
      {tone === 'look' ? (
        <span className="hl mx-0">{children}</span>
      ) : (
        <>
          <span aria-hidden className="size-2 animate-pulse rounded-full border border-foreground motion-reduce:animate-none" />
          {children}
        </>
      )}
      {href && action ? (
        <a className="underline underline-offset-2" href={href}>
          {action}
        </a>
      ) : null}
    </p>
  );
}
