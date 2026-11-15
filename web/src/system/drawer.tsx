import { Dialog } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Detail about one thing, over the page it was opened from. Closes on Escape or a press outside. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-background/70 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-(--frame) bg-card text-sm outline-none transition-transform duration-150 ease-out data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none">
          <header className="flex items-start gap-3 px-5 pt-5 pb-4">
            <Dialog.Title className="title min-w-0 flex-1 break-words">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="press -mt-1 -mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground"
            >
              <XIcon className="size-4" />
            </Dialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto px-5 pb-8">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
