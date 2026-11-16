import { Dialog as Base } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// What a Panel and a Dialog share, so the two read as one kind of thing: the same dimming behind, the
// same header, the same gutters, the same footer. Not exported from the system: use Panel or Dialog.

/**
 * Dims what is behind. At the popup's own level, so a layer opened over another (a dialog from a panel)
 * dims that one too: portals are added in order, and the later wins at the same level. Base UI draws no
 * backdrop for a nested dialog unless forced.
 */
export function Backdrop() {
  return (
    <Base.Backdrop
      forceRender
      className="fixed inset-0 z-50 bg-background/70 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
    />
  );
}

export const GUTTER = 'px-5 md:px-6';

export function LayerHeader({ title, subtitle, close = true }: { title: string; subtitle?: ReactNode; close?: boolean | 'phone' }) {
  return (
    <header className={cn('flex items-start gap-3 pt-5 pb-4', GUTTER)}>
      <div className="min-w-0 flex-1">
        <Base.Title className="title break-words">{title}</Base.Title>
        {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
      </div>
      {close ? (
        <Base.Close
          aria-label="Close"
          aria-keyshortcuts="Escape"
          className={cn(
            'press -mt-0.5 -mr-2 flex size-(--control) shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground',
            close === 'phone' && 'md:hidden',
          )}
        >
          <XIcon className="size-4" />
        </Base.Close>
      ) : null}
    </header>
  );
}

export function LayerBody({ children }: { children: ReactNode }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto pt-1 pb-6', GUTTER)}>{children}</div>;
}

export function LayerFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <footer className={cn('flex flex-wrap items-center gap-2 border-t border-(--rule) py-3', GUTTER, className)}>{children}</footer>;
}
