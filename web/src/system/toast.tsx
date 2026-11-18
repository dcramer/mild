'use client';
import { Toast as Base } from '@base-ui/react/toast';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useShortcut } from './keys.tsx';

/** How long a receipt stays: alone, and with a press in it. A failure stays until dismissed. */
const TIMEOUT = [5000, 8000] as const;

/** What a receipt holds besides its words. */
interface Own {
  /** The description is what kind of thing the title is ("Rule added"), so it heads the toast. */
  kind?: boolean;
  undo?: () => void;
  action?: { label: string; onPress: () => void };
}

/**
 * What a press did, said once, after the list it changed has moved on: "Archive as Marketing", or what was
 * made ("Mail from shop.example.com: archive it") under what kind of thing it is ("Rule added"). A slip: its
 * words in a block of their own, wrapping freely, and its presses on a row under a rule, so neither crowds
 * the other however long the words. A new one replaces the last, so Undo (and Z, Gmail's key for it) always
 * takes back the latest. It floats as a menu does, framed with the one shadow, and Undo is in the
 * highlighter: it is the one thing on it waiting on the reader. On a wide screen it sits in the bottom right,
 * clear of what is read in the middle and above a panel's footer, so Previous and Next stay pressable. A
 * failure is set on red, with dark words as on the highlighter, and stays until dismissed. Wrap the app in
 * `Toaster` once; call `useToast()` where something is done.
 */
export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Base.Provider limit={3}>
      {children}
      <Base.Portal>
        <Base.Viewport className="pointer-events-none fixed inset-x-4 bottom-20 z-[60] mb-[env(safe-area-inset-bottom)] flex flex-col-reverse items-center gap-2 outline-none md:inset-x-auto md:right-6 md:bottom-16 md:items-end">
          <Receipts />
        </Base.Viewport>
      </Base.Portal>
    </Base.Provider>
  );
}

function Receipts() {
  const { toasts } = Base.useToastManager();
  // Only the newest that can be undone answers to Z, so it undoes the last thing done.
  const front = toasts.find((t) => t.transitionStatus !== 'ending' && !t.limited && t.data?.undo)?.id;
  return toasts.map((toast) => <Receipt key={toast.id} toast={toast} front={toast.id === front} />);
}

const PRESS = 'press inline-flex h-(--control) shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-sm font-semibold whitespace-nowrap hover:bg-(--fill)';
/** On red, as on the highlighter, words are dark, and so is the focus ring: the yellow one would not show. */
const ON_RED = 'text-background/75 hover:bg-background/10 hover:text-background focus-visible:outline-background!';

function Receipt({ toast, front }: { toast: Base.Root.ToastObject<Own>; front: boolean }) {
  const { kind, undo, action } = toast.data ?? {};
  const failed = toast.type === 'failure';
  const key = useShortcut('z', 'Undo', () => undo?.(), { enabled: front && undo !== undefined, everywhere: true });
  return (
    <Base.Root
      toast={toast}
      swipeDirection={['down', 'right']}
      className={cn(
        'sheet pointer-events-auto flex w-full flex-col bg-popover md:w-[26rem]',
        'transition-[opacity,translate] duration-150 ease-out data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0 motion-reduce:transition-none',
        failed && 'border-destructive bg-destructive text-background',
      )}
    >
      <div className={cn('flex items-start gap-2 py-3 pl-4', failed ? 'pr-1.5' : 'pr-4')}>
        <div className="flex min-w-0 grow flex-col gap-0.5 pt-0.5">
          <Base.Title render={<span />} className={cn('text-base leading-snug font-medium', failed && 'font-semibold')} />
          <Base.Description render={<span />} className={cn('text-sm', kind && 'order-first', failed ? 'text-background/75' : 'text-muted-foreground')} />
        </div>
        {failed ? (
          <Base.Close aria-label="Dismiss" className={cn(PRESS, ON_RED, 'w-(--control) justify-center px-0')}>
            <XIcon className="size-4" />
          </Base.Close>
        ) : null}
      </div>
      {undo || action ? (
        <div className="flex items-center justify-end gap-1 border-t border-(--rule) p-1.5">
          {action ? (
            <button type="button" className={cn(PRESS, 'text-foreground/75 hover:text-foreground')} onClick={action.onPress}>
              {action.label}
            </button>
          ) : null}
          {undo ? (
            <button type="button" aria-keyshortcuts="z" className={cn(PRESS, 'text-highlight')} onClick={undo}>
              Undo
              {key}
            </button>
          ) : null}
        </div>
      ) : null}
    </Base.Root>
  );
}

interface ToastOptions {
  description?: string;
  /** What kind of thing the title is ("Rule added" over the rule), said above it, in place of a description. */
  kind?: string;
  tone?: 'failure';
  /** One press that follows from what was done, such as answering the rest the same way. */
  action?: { label: string; onPress: () => void };
  /** Takes back what was done: shown as Undo, and Z presses it. Only where the app can really take it back. */
  undo?: () => void;
}

let failures = 0;

/** Say what a press did. */
export function useToast(): (title: string, options?: ToastOptions) => void {
  const manager = Base.useToastManager();
  return (title, { description, kind, tone, action, undo } = {}) => {
    const failed = tone === 'failure';
    // What is said replaces what was said last; each failure keeps its own place until dismissed.
    const id = failed ? `failure-${++failures}` : 'said';
    const closing = (run: () => void) => () => {
      manager.close(id);
      run();
    };
    manager.add<Own>({
      id,
      title,
      ...(description || kind ? { description: kind ?? description } : {}),
      ...(failed ? { type: 'failure', priority: 'high' as const, timeout: 0 } : { timeout: TIMEOUT[undo || action ? 1 : 0] }),
      data: {
        ...(kind ? { kind: true } : {}),
        ...(undo ? { undo: closing(undo) } : {}),
        ...(action ? { action: { label: action.label, onPress: closing(action.onPress) } } : {}),
      },
    });
  };
}
