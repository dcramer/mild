import { Dialog } from '@base-ui/react/dialog';
import { MenuIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { navigate } from '@/lib/route.ts';
import { Button } from './button.tsx';
import { Avatar, Menu, type MenuItem } from './menu.tsx';
import { Select } from './select.tsx';
import { Wordmark } from './type.tsx';

export interface NavItem {
  /** The path, without the leading `/`. */
  to: string;
  label: string;
  /** Something waiting there, shown beside the label. */
  count?: number;
}

const ICON_PRESS = 'press flex size-11 shrink-0 cursor-pointer items-center justify-center hover:bg-(--fill)';

/** The sections of the app, in a line. The current one is highlighted, like the name. */
export function Sections({ items, current }: { items: readonly NavItem[]; current: string }) {
  return (
    <nav aria-label="Sections">
      <ul className="flex flex-wrap gap-x-1 gap-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <a
              href={`/${item.to}`}
              aria-current={item.to === current ? 'page' : undefined}
              className="flex items-baseline gap-1.5 rounded-(--cut) px-2.5 py-1 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:bg-highlight aria-[current=page]:text-highlight-ink"
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
 * `aside` (a line about sift, such as when it last synced) and `account` (who is signed in and what they
 * can do about it, behind their `Avatar`). No bar; it sits straight on the page. On a narrow screen the
 * sections, `aside` and the account move into a panel that covers the screen, opened from a menu button,
 * and `status` gets a line of its own under the bar, where it cannot be missed.
 */
export function Masthead({
  items,
  current,
  status,
  aside,
  account,
}: {
  items: readonly NavItem[];
  current: string;
  status?: ReactNode;
  aside?: ReactNode;
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

      <p className="name min-w-0 flex-1 truncate md:hidden">{here?.label}</p>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger aria-label="Menu" className={`${ICON_PRESS} relative -mr-2 md:hidden`}>
          <MenuIcon className="size-5" />
          {waiting > 0 && here?.count === undefined ? <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-highlight" /> : null}
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Popup className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background px-4 pt-4 pb-8 outline-none transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none md:hidden">
            <div className="flex items-center justify-between">
              <Wordmark />
              <Dialog.Title className="sr-only">Menu</Dialog.Title>
              <Dialog.Close aria-label="Close menu" className={`${ICON_PRESS} -mr-2`}>
                <XIcon className="size-5" />
              </Dialog.Close>
            </div>
            <nav aria-label="Sections" className="mt-8">
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
            {aside || account ? (
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-10 text-sm text-muted-foreground">
                {aside}
                {account ? (
                  <>
                    <span className="break-all">{account.name}</span>
                    {account.items.map((item) => (
                      <Button key={item.label} variant="quiet" disabled={item.disabled} title={item.note} onClick={item.onSelect}>
                        {item.label}
                      </Button>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {status ? <div className="flex basis-full flex-wrap gap-x-4 gap-y-1 pt-2 md:hidden">{status}</div> : null}
    </header>
  );
}

/**
 * The pages within a section. Quieter than the sections: the current page is marked with a stroke of
 * highlighter, not filled with it. Beside the page on a wide screen; a select above it on a narrow one.
 */
export function SubNav({ label, items, current, children }: { label: string; items: readonly NavItem[]; current: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-4 md:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="md:hidden">
        <Select label={label} value={current} options={items.map((item) => [item.to, item.label] as const)} onChange={(to) => navigate(`/${to}`)} />
      </div>
      <nav aria-label={label} className="hidden md:block">
        <ul className="sticky top-5 flex flex-col gap-y-0.5">
          {items.map((item) => (
            <li key={item.to}>
              <a
                href={`/${item.to}`}
                aria-current={item.to === current ? 'page' : undefined}
                className="block border-l-2 border-transparent px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:border-highlight aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}
