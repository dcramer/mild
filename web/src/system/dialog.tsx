import { Dialog as Base } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { KeyLayer } from './keys.tsx';

/**
 * Something opened from the page and read or answered without leaving it: one message, one sender, a
 * form. Centred over the page; covers the screen on a phone. Closes on Escape or a press outside.
 * `wide` is for content with two columns.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  wide,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  wide?: boolean;
  /** Stays in view under the content: the actions that finish the dialog. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Base.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-40 bg-background/75 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Base.Popup
          className={cn(
            'sheet fixed inset-0 z-50 flex flex-col bg-card text-sm outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transition-none',
            'md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[calc(100svh-4rem)] md:w-[calc(100vw-4rem)] md:-translate-x-1/2 md:-translate-y-1/2',
            wide ? 'md:max-w-5xl' : 'md:max-w-xl',
          )}
        >
          <header className="flex items-start gap-4 px-5 pt-5 pb-4 md:px-6">
            <div className="min-w-0 flex-1">
              <Base.Title className="title break-words">{title}</Base.Title>
              {subtitle ? <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div> : null}
            </div>
            <Base.Close
              aria-label="Close"
              className="press -mt-1 -mr-2 flex size-(--control) shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground"
            >
              <XIcon className="size-4" />
            </Base.Close>
          </header>
          <KeyLayer>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 md:px-6">{children}</div>
            {footer ? <footer className="flex flex-wrap items-center gap-2 border-t border-dashed border-(--rule) px-5 py-4 md:px-6">{footer}</footer> : null}
          </KeyLayer>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}
