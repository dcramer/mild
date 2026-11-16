import { Dialog as Base } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { KeyLayer } from './keys.tsx';
import { Backdrop, LayerBody, LayerFooter, LayerHeader } from './layer.tsx';

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
        <Backdrop />
        <Base.Popup
          className={cn(
            'sheet fixed inset-0 z-50 flex flex-col bg-card [--surface:var(--card)] text-sm outline-none transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transition-none',
            'md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[calc(100svh-4rem)] md:w-[calc(100vw-4rem)] md:-translate-x-1/2 md:-translate-y-1/2',
            wide ? 'md:max-w-5xl' : 'md:max-w-xl',
          )}
        >
          <LayerHeader title={title} subtitle={subtitle} />
          <KeyLayer>
            <LayerBody>{children}</LayerBody>
            {footer ? <LayerFooter>{footer}</LayerFooter> : null}
          </KeyLayer>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}
