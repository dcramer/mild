import { Toast as Base } from '@base-ui/react/toast';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * What a press did, said once, in the corner, after the list it changed has moved on: "Learned: …",
 * "Put back in the inbox". It survives the list reloading and the panel moving to the next message.
 * A failure stays until dismissed and is the only one in red; anything else goes after a few seconds.
 * Wrap the app in `Toaster` once; call `useToast()` where something is done.
 */
export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Base.Provider limit={3} timeout={6000}>
      {children}
      <Base.Portal>
        <Base.Viewport className="fixed bottom-4 left-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col-reverse gap-2 outline-none">
          <Toasts />
        </Base.Viewport>
      </Base.Portal>
    </Base.Provider>
  );
}

function Toasts() {
  const { toasts } = Base.useToastManager();
  return toasts.map((toast) => (
    <Base.Root
      key={toast.id}
      toast={toast}
      className="sheet bg-popover text-sm transition-[opacity,translate] duration-150 ease-out data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0 motion-reduce:transition-none"
    >
      <Base.Content className="flex items-start gap-3 py-3 pr-2 pl-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
          <Base.Title className="font-medium in-data-[type=failure]:text-destructive" />
          <Base.Description className="text-muted-foreground" />
        </div>
        <Base.Action className="press flex h-(--control) shrink-0 cursor-pointer items-center bg-(--fill) px-3 font-medium hover:bg-(--fill-strong)" />
        <Base.Close
          aria-label="Dismiss"
          className="press flex size-(--control) shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground"
        >
          <XIcon className="size-4" />
        </Base.Close>
      </Base.Content>
    </Base.Root>
  ));
}

export interface ToastOptions {
  description?: string;
  tone?: 'failure';
  /** One press that follows from what was done, such as undoing it. */
  action?: { label: string; onPress: () => void };
}

/** Say what a press did. */
export function useToast(): (title: string, options?: ToastOptions) => void {
  const manager = Base.useToastManager();
  return (title, options = {}) => {
    manager.add({
      title,
      ...(options.description ? { description: options.description } : {}),
      ...(options.tone ? { type: options.tone, timeout: 0, priority: 'high' as const } : {}),
      ...(options.action ? { actionProps: { children: options.action.label, onClick: options.action.onPress } } : {}),
    });
  };
}
