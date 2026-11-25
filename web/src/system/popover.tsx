'use client';
import { Drawer } from '@base-ui/react/drawer';
import { Popover as Base } from '@base-ui/react/popover';
import type { ReactNode } from 'react';
import { Button } from './button.tsx';
import { usePhone } from './phone.ts';

/**
 * A few things said about what is on the page, opened by a quiet press named `label` and kept off the page itself: a
 * card under the press on a desktop, a sheet up from the bottom on a phone, which a swipe down puts away. Closes on
 * Escape or a press outside. As tall as the screen allows, then it scrolls inside. For a note to glance at (the reader's
 * Why); something to work on is a `Panel`, a form a `Dialog`.
 */
export function Popover({ label, children }: { label: string; children: ReactNode }) {
  const trigger = (props: object) => (
    <Button variant="quiet" {...props}>
      {label}
    </Button>
  );
  if (usePhone())
    return (
      <Drawer.Root swipeDirection="down">
        <Drawer.Trigger render={trigger} />
        <Drawer.Portal>
          <Drawer.Backdrop className="fixed inset-0 z-50 bg-(--scrim) transition-opacity duration-(--motion-layer) data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Drawer.Viewport className="fixed inset-0 z-50 flex items-end">
            <Drawer.Popup className="sheet flex max-h-[85svh] w-full flex-col gap-3 overflow-y-auto bg-card px-4 pt-3 pb-[calc(1.5rem+var(--safe-bottom))] text-sm text-muted-foreground outline-none transition-transform duration-(--motion-sheet) ease-out [transform:translateY(var(--drawer-swipe-movement-y,0px))] data-ending-style:translate-y-full data-starting-style:translate-y-full">
              <span aria-hidden className="mb-1 h-1 w-10 shrink-0 self-center bg-(--rule)" />
              <Drawer.Title className="heading text-foreground">{label}</Drawer.Title>
              {children}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>
    );
  return (
    <Base.Root>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner sideOffset={6} align="start" collisionPadding={16} className="z-50">
          <Base.Popup className="sheet flex max-h-(--available-height) w-[30rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto bg-popover p-4 text-sm text-muted-foreground outline-none">
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
