'use client';
import { Dialog as Base } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { whenSettled } from '@/lib/params.ts';
import { cn } from '@/lib/utils.ts';

// What a Panel and a Dialog share, so the two read as one kind of thing: the same dimming behind, the
// same header, the same gutters, the same footer. Not exported from the system: use Panel or Dialog.

/**
 * Dims what is behind. At the popup's own level, so a layer opened over another (a dialog from a panel)
 * dims that one too: portals are added in order, and the later wins at the same level. Base UI draws no
 * backdrop for a nested dialog unless forced.
 */
export function Backdrop({ still }: { still: boolean }) {
  return (
    <Base.Backdrop
      forceRender
      data-still={still || undefined}
      className="fixed inset-0 z-50 bg-(--scrim) transition-opacity duration-150 data-ending-style:pointer-events-none data-ending-style:opacity-0 data-starting-style:opacity-0 data-still:transition-none motion-reduce:transition-none"
    />
  );
}

/**
 * Layers drawn open together (a message and Settings over it, from the address) open a frame apart in the order they
 * are drawn, so the last is on top and the others are under it: opened in one frame, each would take the other for
 * the page under it.
 */
let opening = Promise.resolve();

/**
 * Whether the person has pressed or typed on this page yet; until then, a layer opening is the address's. Not the
 * browser's `navigator.userActivation`, which a navigation can give the new page.
 */
let handled = false;
if (typeof window !== 'undefined')
  for (const type of ['pointerdown', 'keydown'])
    window.addEventListener(
      type,
      () => {
        handled = true;
      },
      { capture: true, once: true },
    );

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

/**
 * The Root's open state for a layer that is drawn already open. Base UI does not animate a popup that
 * mounts open, so it opens on the next frame; and a layer the reader dismisses (Escape, a press outside,
 * the close button) slides away before `onClose` takes it off the page; `onClosing` is told as it starts to.
 * While it slides it takes no presses (each layer's `data-ending-style:pointer-events-none`): a press there is on the page under it.
 *
 * `still`: drawn open by nothing the person just did (the address, as the page loads), it is in place at once, as the
 * rest of the page is, rather than sliding in a beat after it. It still slides away: `still` ends as it begins to close.
 */
export function useLayerOpen(open: boolean, onClose: () => void, onClosing?: () => void) {
  const [shown, setShown] = useState(false);
  const [still, setStill] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    let drawn = true;
    const pressed = handled;
    opening = opening.then(nextFrame).then(() => {
      if (!drawn) return;
      setStill(!pressed);
      setShown(true);
    });
    return () => {
      drawn = false;
    };
  }, []);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setStill(false);
    if (open) setLeaving(false);
  }
  return {
    still,
    root: {
      open: open && shown && !leaving,
      onOpenChange: (next: boolean) => {
        if (next) return;
        setStill(false);
        setLeaving(true);
        onClosing?.();
      },
      onOpenChangeComplete: (next: boolean) => {
        if (next || !leaving) return;
        onClose();
        // Still drawn once the page has followed `onClose`, it is still wanted (Back went to an entry that has it too): open
        // again. Not before: a close that goes Back is followed a moment later, and would slide in again until then.
        whenSettled(() => setLeaving(false));
      },
    },
  };
}

const GUTTER = 'px-5 md:px-6';

/**
 * The title, what is under it, and the body. On a large screen the header stays and the body scrolls under it, so a
 * panel can lay its body out to the screen's height; below that the two scroll as one, so a tall header (a message
 * to a mailing list, its recipients opened) never leaves the body no room. Close stays in the corner either way, on
 * the layer's own fill, over whatever scrolls under it.
 */
export function LayerContent({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col max-lg:overflow-y-auto">
        <header className={cn('pt-[calc(1.25rem+var(--layer-top,0px))] pb-4 pr-14 md:pr-16', GUTTER)}>
          <Base.Title className="title break-words">{title}</Base.Title>
          {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
        </header>
        {children ? <div className={cn('pt-1 pb-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto', GUTTER)}>{children}</div> : null}
      </div>
      <Base.Close
        aria-label="Close"
        aria-keyshortcuts="Escape"
        className="press absolute top-[calc(1.125rem+var(--layer-top,0px))] right-3 flex size-(--control) cursor-pointer items-center justify-center bg-(--surface) text-muted-foreground hover:bg-(--fill) hover:text-foreground md:right-4"
      >
        <XIcon className="size-4" />
      </Base.Close>
    </>
  );
}

export function LayerFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <footer className={cn('flex flex-wrap items-center gap-2 border-t border-(--rule) py-3', GUTTER, className)}>{children}</footer>;
}
