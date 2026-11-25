'use client';
import { Toast as Base } from '@base-ui/react/toast';
import { XIcon } from 'lucide-react';
import { type FocusEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.ts';
import { useShortcut } from './keys.tsx';
import { ActionIcon } from './does.tsx';
import { LabelChip } from './label.tsx';

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

/** The labels a press gave, as chips, and anything else it did beside them in its word. */
function Given({ did }: { did: readonly Did[] }) {
  return (
    <>
      {did.map((d) =>
        d.action === 'label' ? (
          <LabelChip key={`label:${d.word}`}>{d.word}</LabelChip>
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
 * What a press did, said once, after the list it changed has moved on, in one line: what was done ("Archived" to
 * Marketing) with Undo, or what was made ("Mail from shop.example.com: archive it") after what kind of thing it is
 * ("Rule added"). A press on mail names the mail only to a screen reader: on screen, the row that just left is the
 * context. On a phone it is a strip flush on whatever is at the foot of the screen (the tab bar, a reader's presses, a
 * dialog's footer, `AboveToasts`), so nothing floats over the list or moves to make room; wider, a sheet in the bottom
 * right. A new one replaces the last, so Undo (and Z, Gmail's key for it) always takes back the latest; Undo is in the
 * highlighter, the one thing on it waiting on the reader. Each has a close button and can be swiped away. A failure is a
 * card on red, with dark words as on the highlighter, and stays until dismissed. Wrap the app in `Toaster` once; call
 * `useToast()` where something is done.
 */
export function Toaster({ children }: { children: ReactNode }) {
  return (
    <Base.Provider limit={3} timeout={0}>
      {children}
      <Base.Portal>
        <Base.Viewport className="pointer-events-none fixed inset-x-0 bottom-[max(var(--toasts-above,0px),var(--safe-bottom))] z-[60] flex flex-col-reverse outline-none md:inset-x-auto md:right-6 md:bottom-[calc(max(var(--toasts-above,0px),var(--safe-bottom))+1.5rem)] md:items-end md:gap-2">
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
      // Next frame: it measures, which in the middle of what closed the footer would lay out the page before it is drawn.
      requestAnimationFrame(liftToasts);
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
  if (!failed)
    return (
      <Base.Root toast={toast} swipeDirection={['left', 'right', 'down']} {...hold} className={LINE}>
        {did ? (
          <>
            {/* What it was done to, for a screen reader: on screen, the row that just left is the context. */}
            <Base.Title render={<span />} className="sr-only" />
            <Base.Description
              render={<span />}
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-2 text-sm whitespace-nowrap text-muted-foreground"
            >
              <Done did={did} />
            </Base.Description>
          </>
        ) : (
          // On a phone one line, its words cut short before the presses; wider, they wrap.
          <span className="flex min-w-0 flex-1 items-baseline gap-x-2 py-2.5 text-sm whitespace-nowrap md:flex-wrap md:whitespace-normal">
            <Base.Title render={<span />} className="min-w-0 truncate font-medium md:whitespace-normal" />
            <Base.Description render={<span />} className={cn('shrink-0 text-muted-foreground', kind && 'order-first')} />
          </span>
        )}
        {presses ? <span className="flex shrink-0 items-center">{presses}</span> : null}
        {dismiss}
      </Base.Root>
    );
  // A failure stays until dismissed, on red, its words free to wrap: what went wrong has to be read.
  return (
    <Base.Root
      toast={toast}
      swipeDirection={['left', 'right', 'down']}
      {...hold}
      className={cn(
        MOTION,
        'sheet-wide pointer-events-auto flex w-full items-start gap-2 bg-destructive p-1.5 pl-4 text-background md:w-[26rem] md:border-destructive',
      )}
    >
      <span className="flex min-h-(--control) min-w-0 grow flex-col justify-center gap-0.5 py-1">
        <Base.Title render={<span />} className="text-base leading-snug font-semibold" />
        <Base.Description render={<span />} className={cn('text-sm text-background/75', kind && 'order-first')} />
      </span>
      {presses ? <span className="flex shrink-0 items-center">{presses}</span> : null}
      {dismiss}
    </Base.Root>
  );
}

const MOTION =
  'transition-[opacity,translate] duration-(--motion-layer) ease-out data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0';
/**
 * One line. On a phone a strip flush on whatever is at the foot of the screen (the tab bar, a reader's presses, a
 * dialog's footer), part of it rather than floating over the list; wider, a sheet in the bottom right.
 */
const LINE = cn(
  MOTION,
  'sheet-wide pointer-events-auto flex min-h-12 w-full items-center gap-2 border-t border-(--rule) bg-card pr-1 pl-4 md:min-h-11 md:w-auto md:max-w-[30rem] md:border-(--frame) md:bg-popover',
);

interface ToastOptions {
  description?: string;
  /** What kind of thing the title is ("Rule added" over the rule), said above it, in place of a description. */
  kind?: string;
  tone?: 'failure';
  /**
   * One press that follows from what was done, such as answering the rest the same way. One still being worked out is
   * added once it is, while this is still what is said, and the toast's time starts over for it.
   */
  action?: Action | Promise<Action | undefined>;
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

type Action = { label: string; onPress: () => void };

const SAID = 'said';
let failures = 0;
/** Each saying, counted, so an action worked out late is added only to the one it was for. */
let sayings = 0;
/** The `onGone` of what is said now, until it goes. */
let held: (() => void) | null = null;

/** Say what a press did. */
export function useToast(): (title: string, options?: ToastOptions) => void {
  const manager = Base.useToastManager();
  return (title, { description, kind, tone, action, undo, onGone, did } = {}) => {
    const failed = tone === 'failure';
    // What is said replaces what was said last; each failure keeps its own place until dismissed.
    const id = failed ? `failure-${++failures}` : SAID;
    const saying = failed ? 0 : ++sayings;
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
        ...(action && !(action instanceof Promise) ? { action: { label: action.label, onPress: closing(action.onPress) } } : {}),
      },
    });
    if (action instanceof Promise)
      void action.then((late) => {
        // Gone (put away, timed out, said over) is gone: nothing is put back up.
        if (!late || (!failed && (saying !== sayings || (onGone !== undefined && held !== onGone)))) return;
        manager.update<Own>(id, (was) => ({
          data: { ...was.data, lasts: TIMEOUT[1], action: { label: late.label, onPress: closing(late.onPress) } },
        }));
      });
  };
}
