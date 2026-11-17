import { Dialog } from '@base-ui/react/dialog';
import { MenuIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from './button.tsx';
import { Avatar, Menu, type MenuItem } from './menu.tsx';
import { Wordmark } from './type.tsx';

interface NavItem {
  /** The path, without the leading `/`. */
  to: string;
  label: string;
  /** Something waiting there, shown beside the label. */
  count?: number;
}

const ICON_PRESS = 'press flex size-11 shrink-0 cursor-pointer items-center justify-center hover:bg-(--fill)';

/** The sections of the app, in a line. The current one is highlighted, like the name. */
function Sections({ items, current }: { items: readonly NavItem[]; current: string }) {
  return (
    <nav aria-label="Sections">
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <a
              href={`/${item.to}`}
              aria-current={item.to === current ? 'page' : undefined}
              className="relative flex items-baseline gap-1.5 py-1 text-base leading-normal font-semibold text-muted-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:after:bg-highlight"
            >
              {item.label}
              {item.count ? <span className="text-sm tabular-nums opacity-70">{item.count}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The top of every screen: the name, the sections, `status` (a `Notice`: what is wrong with sift itself),
 * `aside` (a short line about sift that is always worth a glance: when it last synced, what it costs) and
 * `account` (who is signed in and what they can do about it, behind their `Avatar`). No bar; it sits straight
 * on the page. On a narrow screen the bar keeps the name, `aside` and a menu button; the sections and the
 * account move into a panel that covers the screen, with `detail` (what `aside`'s hover card says, which a
 * touch screen never shows) framed above the account. `status` gets a line of its own under the bar.
 */
export function Masthead({
  items,
  current,
  status,
  aside,
  detail,
  account,
}: {
  items: readonly NavItem[];
  current: string;
  status?: ReactNode;
  aside?: ReactNode;
  detail?: ReactNode;
  account?: { name: string; items: readonly MenuItem[] } | undefined;
}) {
  const [open, setOpen] = useState(false);
  // Going somewhere closes the panel.
  useEffect(() => setOpen(false), [current]);
  const here = items.find((item) => item.to === current);
  const waiting = items.reduce((sum, item) => sum + (item.count ?? 0), 0);

  return (
    <header className="flex flex-wrap items-center gap-x-5 pt-4 pb-6 md:pt-5 md:pb-7">
      <a href={`/${items[0]?.to ?? ''}`} aria-label="sift">
        <Wordmark />
      </a>
      <div className="hidden min-w-0 flex-1 items-center gap-x-5 md:flex">
        <Sections items={items} current={current} />
        <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
          {status}
          {aside}
          {account ? (
            <Menu
              label={`Account, ${account.name}`}
              align="end"
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
      </div>

      <div className="flex min-w-0 flex-1 justify-end text-sm text-muted-foreground md:hidden">{aside}</div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger aria-label="Menu" className={`${ICON_PRESS} relative -mr-2 md:hidden`}>
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
                    <a
                      href={`/${item.to}`}
                      aria-current={item.to === current ? 'page' : undefined}
                      className="statement flex min-h-12 items-center gap-3 text-muted-foreground"
                      onClick={() => setOpen(false)}
                    >
                      <span className={item.to === current ? 'hl mx-0 px-2' : undefined}>{item.label}</span>
                      {item.count ? <span className="text-base font-medium tabular-nums">{item.count}</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            {detail ? <div className="sheet mt-auto p-4 text-sm">{detail}</div> : null}
            {account ? (
              <div className={`${detail ? 'mt-6' : 'mt-auto'} flex flex-col gap-4 border-t border-(--rule) pt-5`}>
                <p className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Avatar name={account.name} />
                  <span className="min-w-0 break-all">{account.name}</span>
                </p>
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
      {status ? <div className="flex basis-full flex-wrap gap-x-4 gap-y-1 pt-2 md:hidden">{status}</div> : null}
    </header>
  );
}
