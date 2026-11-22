'use client';
import { type LucideIcon, SquarePenIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Anchor } from './anchor.tsx';
import { useShortcut } from './keys.tsx';
import { type MailboxChoice, mailboxChoices } from './mailbox.tsx';
import { Avatar, Menu, type MenuItem } from './menu.tsx';
import { Tooltip } from './tooltip.tsx';
import { Wordmark } from './type.tsx';

/** A section, or Compose: its icon in a rounded square, which the current section fills with the highlighter. */
const TILE = 'relative flex size-10 cursor-pointer items-center justify-center rounded-[8px] transition-colors duration-100 motion-reduce:transition-none';

export interface NavItem {
  /** The path, without the leading `/`. */
  to: string;
  label: string;
  icon: LucideIcon;
  /** Something waiting there, shown as a bubble on the icon's corner. */
  count?: number;
}

/**
 * The sections down the left of every screen on a desktop: the name at the top, then `compose` (writing a new message,
 * with Inbox on, also C, with no keycap: the rail is not a list worked through), then each section as its icon
 * in a rounded square, named when pointed at, the current one filled with the highlighter, then at the foot `aside` (Mild's line, stacked), the
 * `mailbox` the dashboard shows, beside whose they are, and `account` (who is signed in, behind their `Avatar`). No fill; a line sets it apart. As tall as the window, and never taller
 * than what holds it. Given no sections it is the name alone, as `Masthead` is.
 */
export function Rail({
  items,
  current,
  aside,
  mailbox,
  account,
  compose,
}: {
  items: readonly NavItem[];
  current: string;
  compose?: (() => void) | undefined;
  aside?: ReactNode;
  mailbox?: MailboxChoice | undefined;
  account?: { name: string; items: readonly MenuItem[] } | undefined;
}) {
  return (
    <header className="sticky top-0 hidden h-svh max-h-full w-[calc(4.5rem+var(--safe-left))] shrink-0 flex-col items-center border-r border-(--frame) pt-[calc(1.25rem+var(--safe-top))] pb-[calc(1rem+var(--safe-bottom))] pl-(--safe-left) md:flex">
      <Anchor href={`/${items[0]?.to ?? ''}`} aria-label="Mild" className="flex min-h-(--control) items-center">
        <Wordmark />
      </Anchor>
      {compose ? <Compose onPress={compose} /> : null}
      {items.length > 0 ? (
        <nav aria-label="Sections" className={cn('w-full', compose ? 'mt-5' : 'mt-8')}>
          <ul className="flex flex-col items-center gap-3">
            {items.map(({ to, label, icon: Icon, count }) => (
              <li key={to}>
                <Tooltip says={label} side="right" className="flex">
                  <Anchor
                    href={`/${to}`}
                    aria-current={to === current ? 'page' : undefined}
                    className={cn(
                      TILE,
                      to === current ? 'bg-(--highlight) text-(--highlight-ink)' : 'text-muted-foreground hover:bg-(--fill) hover:text-foreground',
                    )}
                  >
                    <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                    {count ? (
                      <span
                        aria-hidden
                        className="absolute -top-2 -right-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-label leading-none font-semibold text-background tabular-nums"
                      >
                        {count > 99 ? '99+' : count}
                      </span>
                    ) : null}
                    {/* The name, then the count ("For review 12"). */}
                    <span className="sr-only">{count ? `${label} ${count}` : label}</span>
                  </Anchor>
                </Tooltip>
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
              items={[...(mailbox ? mailboxChoices(mailbox) : []), ...account.items]}
            />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

/** A new message: a press like a section's, set apart above them, and C from anywhere on the page, which `?` lists. */
function Compose({ onPress }: { onPress: () => void }) {
  void useShortcut('c', 'New message', onPress);
  return (
    <Tooltip says="Compose" side="right" className="mt-8 flex">
      <button type="button" onClick={onPress} aria-keyshortcuts="c" className={cn(TILE, 'bg-(--fill) text-foreground hover:bg-(--fill-strong)')}>
        <SquarePenIcon aria-hidden className="size-5" strokeWidth={1.75} />
        <span className="sr-only">Compose</span>
      </button>
    </Tooltip>
  );
}
