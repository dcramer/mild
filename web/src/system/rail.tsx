'use client';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Anchor } from './anchor.tsx';
import { Avatar, Menu, type MenuItem } from './menu.tsx';
import { Wordmark } from './type.tsx';

export interface NavItem {
  /** The path, without the leading `/`. */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Something waiting there, shown beside the icon. */
  count?: number;
}

/**
 * The sections down the left of every screen on a desktop: the name at the top, then each section as its icon over
 * its name, the current one's icon in the highlighter, then at the foot `aside` (Sift's line, stacked) and `account`
 * (who is signed in, behind their `Avatar`). No fill; a line sets it apart. As tall as the window, and never taller
 * than what holds it. Given no sections it is the name alone, as `Masthead` is.
 */
export function Rail({
  items,
  current,
  aside,
  account,
}: {
  items: readonly NavItem[];
  current: string;
  aside?: ReactNode;
  account?: { name: string; items: readonly MenuItem[] } | undefined;
}) {
  return (
    <header className="sticky top-0 hidden h-svh max-h-full w-18 shrink-0 flex-col items-center border-r border-(--frame) pt-5 pb-4 md:flex">
      <Anchor href={`/${items[0]?.to ?? ''}`} aria-label="Sift" className="flex min-h-(--control) items-center">
        <Wordmark />
      </Anchor>
      {items.length > 0 ? (
        <nav aria-label="Sections" className="mt-8 w-full">
          <ul className="flex flex-col items-center gap-3">
            {items.map(({ to, label, icon: Icon, count }) => (
              <li key={to}>
                <Anchor
                  href={`/${to}`}
                  aria-current={to === current ? 'page' : undefined}
                  className="group flex w-16 cursor-pointer flex-col items-center gap-1 text-label font-semibold text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-8 min-w-12 items-center justify-center gap-1 px-2 transition-colors duration-100 motion-reduce:transition-none',
                      to === current ? 'hl mx-0' : 'rounded-(--corner) group-hover:bg-(--fill)',
                    )}
                  >
                    <Icon className="size-5" strokeWidth={1.75} />
                    {count ? <span className="tabular-nums">{count}</span> : null}
                  </span>
                  <span className="text-center">{label}</span>
                  {/* Read after the name ("For review 12"); the figure shown is beside the icon. */}
                  {count ? <span className="sr-only">{count}</span> : null}
                </Anchor>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {aside || account ? (
        <div className="mt-auto flex flex-col items-center gap-4 text-label text-muted-foreground">
          {aside}
          {account ? (
            <Menu
              label={`Account, ${account.name}`}
              trigger={<Avatar name={account.name} />}
              heading={
                <>
                  <p className="slug text-muted-foreground">Signed in</p>
                  <p className="mt-1 font-medium break-all">{account.name}</p>
                </>
              }
              items={account.items}
            />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
