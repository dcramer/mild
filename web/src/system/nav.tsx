'use client';
import { Dialog } from '@base-ui/react/dialog';
import { MenuIcon, XIcon } from 'lucide-react';
import { type ReactNode, useContext, useState } from 'react';
import { Anchor } from './anchor.tsx';
import { Button } from './button.tsx';
import { Cloud, FinePrint } from './fine-print.tsx';
import { type MailboxChoice, MailboxSwitch } from './mailbox.tsx';
import { Avatar, type MenuItem } from './menu.tsx';
import type { NavItem } from './rail.tsx';
import { Wordmark } from './type.tsx';

const ICON_PRESS = 'press flex size-11 shrink-0 cursor-pointer items-center justify-center hover:bg-(--fill)';

/**
 * The top of every screen on a phone, where `Rail` is not shown: the name, `aside` (Sift's line) and a menu button.
 * The sections and `account` move into a panel that covers the screen, the sections followed by `FinePrint` as a list,
 * with `detail` (what `aside`'s hover card says, which a touch screen never shows) framed above the account, and the
 * `mailbox` the dashboard shows under whose they are.
 */
export function Masthead({
  items,
  current,
  aside,
  detail,
  mailbox,
  account,
}: {
  items: readonly NavItem[];
  current: string;
  aside?: ReactNode;
  detail?: ReactNode;
  mailbox?: MailboxChoice | undefined;
  account?: { name: string; items: readonly MenuItem[] } | undefined;
}) {
  const [open, setOpen] = useState(false);
  // Going somewhere closes the panel.
  const [shownAt, setShownAt] = useState(current);
  if (shownAt !== current) {
    setShownAt(current);
    setOpen(false);
  }
  const cloud = useContext(Cloud);
  const here = items.find((item) => item.to === current);
  const waiting = items.reduce((sum, item) => sum + (item.count ?? 0), 0);

  // No sections: the page before it knows who is signed in, which may yet be the sign-in page, so the name alone.
  if (items.length === 0)
    return (
      <header className="flex items-center pt-4 pb-6 md:hidden">
        {/* As tall as the row the menu button makes, so the name stays put as it arrives. */}
        <Anchor href="/" aria-label="Sift" className="flex min-h-11 items-center">
          <Wordmark />
        </Anchor>
      </header>
    );

  return (
    <header className="flex items-center gap-x-5 pt-4 pb-6 md:hidden">
      <Anchor href={`/${items[0]?.to ?? ''}`} aria-label="Sift">
        <Wordmark />
      </Anchor>
      <div className="flex min-w-0 flex-1 justify-end text-sm text-muted-foreground">{aside}</div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger aria-label="Menu" className={`${ICON_PRESS} relative -mr-2`}>
          <MenuIcon className="size-5" />
          {waiting > 0 && here?.count === undefined ? <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-highlight" /> : null}
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Popup className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background px-4 pt-4 pb-8 outline-none transition-opacity duration-150 data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none md:hidden">
            <div className="flex items-center justify-between">
              <Wordmark />
              <Dialog.Title className="sr-only">Menu</Dialog.Title>
              <Dialog.Close aria-label="Close menu" className={`${ICON_PRESS} -mr-2`}>
                <XIcon className="size-5" />
              </Dialog.Close>
            </div>
            <nav aria-label="Sections" className="mt-14">
              <ul className="flex flex-col gap-1">
                {items.map((item) => (
                  <li key={item.to}>
                    <Anchor
                      href={`/${item.to}`}
                      aria-current={item.to === current ? 'page' : undefined}
                      className="statement flex min-h-12 items-center gap-3 text-muted-foreground"
                      onClick={() => setOpen(false)}
                    >
                      <span className={item.to === current ? 'hl mx-0 px-2' : undefined}>{item.label}</span>
                      {item.count ? <span className="text-base font-medium tabular-nums">{item.count}</span> : null}
                    </Anchor>
                  </li>
                ))}
              </ul>
            </nav>
            {cloud ? (
              <div className="mt-8">
                <FinePrint list />
              </div>
            ) : null}
            {detail ? <div className="sheet mt-auto p-4 text-sm">{detail}</div> : null}
            {account ? (
              <div className={`${detail ? 'mt-6' : 'mt-auto'} flex flex-col gap-4 border-t border-(--rule) pt-5`}>
                <p className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Avatar name={account.name} />
                  <span className="min-w-0 break-all">{account.name}</span>
                </p>
                {mailbox ? (
                  <MailboxSwitch
                    {...mailbox}
                    onChange={(chosen) => {
                      setOpen(false);
                      mailbox.onChange(chosen);
                    }}
                  />
                ) : null}
                <div className="grid auto-cols-fr grid-flow-col gap-2">
                  {account.items.map((item) => (
                    <Button
                      key={item.label}
                      disabled={item.disabled}
                      {...(item.note ? { why: item.note } : {})}
                      className="justify-center"
                      onClick={() => {
                        setOpen(false);
                        item.onSelect();
                      }}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}
