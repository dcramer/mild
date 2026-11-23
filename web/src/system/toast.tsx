'use client';
import { Toast as Base } from '@base-ui/react/toast';
import { TagIcon, XIcon } from 'lucide-react';
import { type FocusEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useShortcut } from './keys.tsx';
import { ActionIcon } from './does.tsx';

/** How long a receipt stays: alone, and with a press in it. A failure stays until dismissed. */
const TIMEOUT = [5000, 8000] as const;

/** What a receipt holds besides its words. */
interface Own {
  /** How long it stays, in milliseconds; a failure has none and stays until dismissed. */
  lasts?: number;
  /** The description is what kind of thing the title is ("Rule added"), so it heads the toast. */
  kind?: boolean;
  undo?: () => void;
  action?: { label: string; onPress: () => void };
  did?: readonly [Did, ...Did[]];
}

/** One thing a press did: an action's key (`Does`), or `label` for a label given, and its word or the label's name. */
export interface Did {
  action: string;
  word: string;
}

/** A label given, as a thing of its own: its tag and its name. */
function LabelChip({ name }: { name: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 bg-(--fill-strong) px-1.5 text-label font-semibold whitespace-nowrap text-foreground">
      <TagIcon aria-hidden className="size-3" />
      {name}
    </span>
  );
}

/** The labels a press gave, as chips, and anything else it did beside them in its word. */
function Given({ did }: { did: readonly Did[] }) {
  return (
    <>
      {did.map((d) =>
        d.action === 'label' ? (
          <LabelChip key={`label:${d.word}`} name={d.word} />
        ) : (
          <span key={d.action} className="inline-flex shrink-0 items-center gap-1 text-label whitespace-nowrap text-muted-foreground">
            <ActionIcon action={d.action} />
            {d.word}
          </span>
        ),
      )}
    </>
  );
}

/** What a press did, under what it was done to: its icon and word, then "as" or "to" the labels it gave, then the rest. */
function Done({ did: [first, ...also] }: { did: readonly [Did, ...Did[]] }) {
  const labels = also.filter((d) => d.action === 'label');
  return (
    <>
      <span className="inline-flex shrink-0 items-center gap-1.5 font-medium whitespace-nowrap text-foreground">
        <ActionIcon action={first.action} />
        {first.word}
      </span>
      {labels.length > 0 ? <span>{first.action === 'keep' ? 'as' : 'to'}</span> : null}
      <Given did={labels} />
      <Given did={also.filter((d) => d.action !== 'label')} />
    </>
  );
}

/**
 * What a press did, said once, after the list it changed has moved on: the mail it was done to over what was done
 * ("Archived" to Marketing), or what was made ("Mail from shop.example.com: archive it") under what kind of thing it is
 * ("Rule added"). A slip: its
 * words in a block of their own, wrapping freely, and its presses on a row under a rule, so neither crowds
 * the other however long the words. A new one replaces the last, so Undo (and Z, Gmail's key for it) always
 * takes back the latest. It floats as a menu does, framed with the one shadow, and Undo is in the
 * highlighter: it is the one thing on it waiting on the reader. On a wide screen it sits in the bottom right,
 * and on a phone across the bottom, at the edge; while a panel or dialog is open it rises above its footer
 * (`AboveToasts`), so Previous, Next and Save stay pressable. Each has a close button. A failure is set on red, with dark words as on the highlighter, and stays until dismissed. Wrap the app in
 * `Toaster` once; call `useToast()` where something is done.
 */
export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Base.Provider limit={3} timeout={0}>
      {children}
      <Base.Portal>
        <Base.Viewport className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--toasts-above,0px)+1rem)] z-[60] mb-(--safe-bottom) flex flex-col-reverse items-center gap-2 outline-none md:inset-x-auto md:right-6 md:bottom-[calc(var(--toasts-above,0px)+1.5rem)] md:items-end">
          <Receipts />
        </Base.Viewport>
      </Base.Portal>
    </Base.Provider>
  );
}

const FOOT = 'data-toasts-above';

/** Lifts toasts by the tallest footer open, read again whenever one opens, closes or changes size. */
function liftToasts() {
  const tallest = Math.max(0, ...[...document.querySelectorAll<HTMLElement>(`[${FOOT}]`)].map((foot) => foot.offsetHeight));
  document.documentElement.style.setProperty('--toasts-above', `${tallest}px`);
}

/** A layer's footer, which toasts sit above while it is open. */
export function AboveToasts({ children, className = 'shrink-0' }: { children: ReactNode; className?: string }) {
  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = foot.current;
    if (!element) return;
    const observer = new ResizeObserver(liftToasts);
    observer.observe(element);
    return () => {
      observer.disconnect();
      liftToasts();
    };
  }, []);
  return (
    <div ref={foot} {...{ [FOOT]: '' }} className={className}>
      {children}
    </div>
  );
}

function Receipts() {
  const { toasts, close } = Base.useToastManager();
  // A page closed or put away sends what is held: it may never be shown again to be undone.
  useEffect(() => {
    // Sent here, not once the toast has closed, which is after the page has gone.
    const away = (event: Event) => {
      if ((event.type !== 'pagehide' && document.visibilityState !== 'hidden') || held === null) return;
      const send = held;
      held = null;
      send();
      close(SAID);
    };
    document.addEventListener('visibilitychange', away);
    window.addEventListener('pagehide', away);
    return () => {
      document.removeEventListener('visibilitychange', away);
      window.removeEventListener('pagehide', away);
    };
  }, [close]);
  // Only the newest that can be undone answers to Z, so it undoes the last thing done.
  const front = toasts.find((t) => t.transitionStatus !== 'ending' && !t.limited && t.data?.undo)?.id;
  return toasts.map((toast) => <Receipt key={toast.id} toast={toast} front={toast.id === front} close={close} />);
}

/**
 * Closes the toast once it has been on screen for `lasts` while nothing held it: a mouse pointing at it, or
 * keyboard focus in it. Said again, it starts over, even in the place of one still fading out, whose countdown it
 * would otherwise inherit (each saying is new `data`). Base UI's own timer is off because it also stops whenever
 * the window loses focus, and reading a message (an iframe) or another window takes it, so a toast stayed up
 * until the reader came back to the page.
 */
function useLifetime(toast: Base.Root.ToastObject<Own>, close: (id: string) => void) {
  const lasts = toast.transitionStatus === 'ending' ? undefined : toast.data?.lasts;
  const said = toast.data;
  const [pointing, setPointing] = useState(false);
  const [focused, setFocused] = useState(false);
  const left = useRef({ said, ms: lasts ?? 0 });
  useEffect(() => {
    if (lasts === undefined || pointing || focused) return;
    if (left.current.said !== said) left.current = { said, ms: lasts };
    const from = Date.now();
    const timer = setTimeout(() => close(toast.id), left.current.ms);
    return () => {
      clearTimeout(timer);
      left.current.ms -= Date.now() - from;
    };
  }, [lasts, said, pointing, focused, close, toast.id]);
  return {
    onPointerEnter: (event: PointerEvent) => event.pointerType === 'mouse' && setPointing(true),
    onPointerLeave: () => setPointing(false),
    onFocus: (event: FocusEvent) => event.target.matches(':focus-visible') && setFocused(true),
    onBlur: (event: FocusEvent) => !event.currentTarget.contains(event.relatedTarget) && setFocused(false),
  };
}

const PRESS = 'press inline-flex h-(--control) shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-sm font-semibold whitespace-nowrap hover:bg-(--fill)';
/** On red, as on the highlighter, words are dark, and so is the focus ring: the yellow one would not show. */
const ON_RED = 'text-background/75 hover:bg-background/10 hover:text-background focus-visible:outline-background!';

function Receipt({ toast, front, close }: { toast: Base.Root.ToastObject<Own>; front: boolean; close: (id: string) => void }) {
  const { kind, undo, action, did } = toast.data ?? {};
  const failed = toast.type === 'failure';
  const hold = useLifetime(toast, close);
  const key = useShortcut('z', 'Undo', () => undo?.(), { enabled: front && undo !== undefined, everywhere: true });
  const dismiss = (
    // Not Base UI's Close, which is hidden from assistive technology unless a pointer is over the toasts.
    <button
      type="button"
      aria-label="Dismiss"
      onClick={() => close(toast.id)}
      className={cn(PRESS, 'w-(--control) justify-center px-0', failed ? ON_RED : 'text-muted-foreground hover:text-foreground')}
    >
      <XIcon className="size-4" />
    </button>
  );
  const presses =
    undo || action ? (
      <>
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
      </>
    ) : null;
  if (did) {
    // Two rows, on a phone as on a desktop: the mail with its close button, then what was done with its presses at the end
    // of its first line, where they stay however it wraps.
    return (
      <Base.Root toast={toast} swipeDirection={['down', 'right']} {...hold} className={ROOT}>
        <div className="flex items-center gap-2 pt-1.5 pr-1.5 pl-4">
          <Base.Title render={<span />} className="min-w-0 grow truncate text-base leading-snug font-medium" />
          {dismiss}
        </div>
        <div className="flex items-start gap-2 pr-1.5 pb-1.5 pl-4">
          {/* Padded to a press's height, so its first line is level with them. */}
          <Base.Description render={<span />} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 py-1.5 text-sm text-muted-foreground">
            <Done did={did} />
          </Base.Description>
          {presses ? <span className="flex shrink-0 items-center gap-1">{presses}</span> : null}
        </div>
      </Base.Root>
    );
  }
  return (
    <Base.Root
      toast={toast}
      swipeDirection={['down', 'right']}
      {...hold}
      className={cn(
        ROOT,
        // On a phone a receipt is one line, its kind and then its words, with its presses at the end, so it covers as little of the list as it can.
        !failed && 'phone:flex-row phone:items-center',
        failed && 'border-destructive bg-destructive text-background',
      )}
    >
      {/* On a phone its words, its presses and then its close button share the one row. */}
      <div className={cn('flex items-start gap-2 p-1.5 pl-4', !failed && 'phone:contents')}>
        <div
          className={cn(
            'flex min-h-(--control) min-w-0 grow flex-col justify-center gap-0.5 py-1',
            !failed && 'phone:flex-row phone:items-baseline phone:gap-2 phone:py-2.5 phone:pl-4',
          )}
        >
          <Base.Title render={<span />} className={cn('text-base leading-snug font-medium', failed ? 'font-semibold' : 'phone:min-w-0 phone:truncate')} />
          <Base.Description
            render={<span />}
            className={cn('text-sm', kind && 'order-first', failed ? 'text-background/75' : 'text-muted-foreground phone:shrink-0')}
          />
        </div>
        <span className={cn('flex', !failed && 'phone:order-last phone:mr-1.5')}>{dismiss}</span>
      </div>
      {presses ? (
        <div className="flex shrink-0 items-center justify-end gap-1 border-t border-(--rule) p-1.5 phone:border-t-0 phone:pl-0">{presses}</div>
      ) : null}
    </Base.Root>
  );
}

const ROOT =
  'sheet pointer-events-auto flex w-full flex-col bg-popover md:w-[26rem] transition-[opacity,translate] duration-150 ease-out data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0 motion-reduce:transition-none';

interface ToastOptions {
  description?: string;
  /** What kind of thing the title is ("Rule added" over the rule), said above it, in place of a description. */
  kind?: string;
  tone?: 'failure';
  /** One press that follows from what was done, such as answering the rest the same way. */
  action?: { label: string; onPress: () => void };
  /** Takes back what was done: shown as Undo, and Z presses it. Only where the app can really take it back. */
  undo?: () => void;
  /**
   * Called once when it goes without Undo pressed: it timed out, was swiped away, a newer one took its place, or
   * the page was closed or hidden. A press can wait for this before it is sent, so Undo has nothing to take back.
   */
  onGone?: () => void;
  /** A press on mail: the title is what it was done to (the subject), and these, under it, what was done ("Archived" to the label it gave). */
  did?: readonly [Did, ...Did[]];
}

const SAID = 'said';
let failures = 0;
/** The `onGone` of what is said now, until it goes. */
let held: (() => void) | null = null;

/** Say what a press did. */
export function useToast(): (title: string, options?: ToastOptions) => void {
  const manager = Base.useToastManager();
  return (title, { description, kind, tone, action, undo, onGone, did } = {}) => {
    const failed = tone === 'failure';
    // What is said replaces what was said last; each failure keeps its own place until dismissed.
    const id = failed ? `failure-${++failures}` : SAID;
    if (!failed) {
      const replaced = held;
      held = onGone ?? null;
      replaced?.();
    }
    const gone = () => {
      if (onGone === undefined || held !== onGone) return;
      held = null;
      onGone();
    };
    const closing = (run: () => void) => () => {
      manager.close(id);
      run();
    };
    manager.add<Own>({
      id,
      title,
      onClose: gone,
      ...(description || kind ? { description: kind ?? description } : {}),
      ...(failed ? { type: 'failure', priority: 'high' as const } : {}),
      data: {
        ...(failed ? {} : { lasts: TIMEOUT[undo || action ? 1 : 0] }),
        ...(kind ? { kind: true } : {}),
        ...(did ? { did } : {}),
        ...(undo
          ? {
              undo: () => {
                if (held === onGone) held = null;
                closing(undo)();
              },
            }
          : {}),
        ...(action ? { action: { label: action.label, onPress: closing(action.onPress) } } : {}),
      },
    });
  };
}
