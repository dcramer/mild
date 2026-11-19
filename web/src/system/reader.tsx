'use client';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { AnswerPicker } from './answer-picker.tsx';
import { Button } from './button.tsx';
import { keyName, useShortcut } from './keys.tsx';
import { Heads, Table, Td, Th, Tr } from './table.tsx';
import { Kbd } from './type.tsx';

/** As wide as a line of mail reads well, and as wide as a 600px email with room either side. */
const READING = 'max-w-[46rem]';

/**
 * One message or conversation, opened from a list in the list's place, inside the frame: the bar (`ReaderBar`), the
 * subject as the page's heading, Sift's part (`AnswerRow`), then the conversation and whatever answers it. `side` is a
 * column beside the conversation on a wide screen, and under it narrower, for what is said about the message rather
 * than in it. It takes the focus as it opens, so Enter presses nothing and the keys are its own.
 */
export function Reader({
  ref,
  bar,
  title,
  answer,
  side,
  children,
}: {
  ref?: Ref<HTMLElement>;
  bar: ReactNode;
  title: ReactNode;
  answer?: ReactNode;
  side?: ReactNode;
  children: ReactNode;
}) {
  const own = useRef<HTMLElement>(null);
  useImperativeHandle(ref, () => own.current!, []);
  // Unless what it opened with took the focus first: a reply opened by its address.
  useEffect(() => {
    if (!own.current?.contains(document.activeElement)) own.current?.focus({ preventScroll: true });
  }, []);
  const heading = useId();
  return (
    <section ref={own} tabIndex={-1} aria-labelledby={heading} className="flex flex-col gap-4 outline-none">
      <div className={READING}>{bar}</div>
      <div className={cn('flex flex-col gap-3', READING)}>
        <h1 id={heading} className="statement wrap-anywhere">
          {title}
        </h1>
        {answer}
      </div>
      <div className={side ? 'mt-4 flex flex-col gap-12 xl:grid xl:grid-cols-[minmax(0,46rem)_20rem] xl:items-start xl:gap-16' : cn('mt-4', READING)}>
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
        {side ? <aside className="flex min-w-0 flex-col gap-8">{side}</aside> : null}
      </div>
    </section>
  );
}

const NO_PRESSES: readonly Press[] = [];

interface Press {
  label: string;
  key: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
}

/** Presses on what the reader shows, each with its key, on one line: Archive and Mark unread in its bar, Reply, Reply all and Forward under the conversation. */
export function Presses({ presses }: { presses: readonly Press[] }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {presses.map((p) => (
        <Button key={p.label} {...(p.quiet ? { variant: 'quiet' as const } : {})} shortcut={p.key} disabled={p.disabled} onClick={p.onPress}>
          {p.label}
        </Button>
      ))}
    </span>
  );
}

/**
 * The top of the reader: back to the list by its name (Esc), the presses on what it shows, where it is in the list,
 * and previous and next (K and J, or ← and →). On a phone the presses take a line under Back, without keycaps; nothing wraps.
 */
export function ReaderBar({
  back,
  onBack,
  presses = NO_PRESSES,
  position,
  onPrevious,
  onNext,
}: {
  /** The list's name: "Inbox". */
  back: string;
  onBack: () => void;
  presses?: readonly Press[];
  /** "3 of 12". */
  position?: string | undefined;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}) {
  const stepping = onPrevious !== undefined || onNext !== undefined;
  return (
    <div className="flex items-center gap-x-3 gap-y-2 max-md:flex-wrap">
      <Button variant="quiet" className="-ml-3" aria-label={`Back to ${back}`} shortcut={{ key: 'Escape', label: 'Back to the list' }} onClick={onBack}>
        <ArrowLeftIcon aria-hidden />
        {back}
      </Button>
      <div className={cn('flex min-w-0 items-center gap-1.5 md:ml-auto', presses.length > 0 ? 'max-md:basis-full' : 'max-md:ml-auto')}>
        {presses.length > 0 ? <Presses presses={presses} /> : null}
        {position ? <span className="px-2 text-sm whitespace-nowrap text-muted-foreground tabular-nums max-md:ml-auto">{position}</span> : null}
        {stepping ? (
          <>
            <Step label="Previous" keys={['k', 'ArrowLeft']} onPress={onPrevious} icon={<ChevronUpIcon aria-hidden />} />
            <Step label="Next" keys={['j', 'ArrowRight']} onPress={onNext} icon={<ChevronDownIcon aria-hidden />} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Previous or next in the list. Its keys work only while there is somewhere to go; the first is drawn. */
function Step({ label, keys, onPress, icon }: { label: string; keys: readonly string[]; onPress: (() => void) | undefined; icon: ReactNode }) {
  const hint = useShortcut(keys, label, () => onPress?.(), { enabled: onPress !== undefined });
  return (
    <Button variant="quiet" aria-label={label} aria-keyshortcuts={keys.join(' ')} disabled={!onPress} onClick={() => onPress?.()} className="px-2">
      {icon}
      {hint ? <Kbd className="hidden md:inline-flex">{keyName(keys[0])}</Kbd> : null}
    </Button>
  );
}

/**
 * Sift's part of the reader, on one line under the title: what the message is (an `AnswerPicker`, agreed in one
 * press), Why, and the presses that make a rule (`children`). Why opens what Sift said under the line; `whyOpen` starts
 * it open, where answering is the job (For review). On a phone the picker takes what the presses leave.
 */
export function AnswerRow({
  picker,
  why,
  whyOpen = false,
  children,
}: {
  picker: ComponentProps<typeof AnswerPicker>;
  why?: ReactNode;
  whyOpen?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(whyOpen);
  const said = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <AnswerPicker {...picker} className={cn('min-w-0 max-md:flex-1 md:w-72', picker.className)} />
        {why ? (
          <Button variant="quiet" className="ml-1" aria-expanded={open} aria-controls={said} onClick={() => setOpen(!open)}>
            Why
          </Button>
        ) : null}
        {children}
      </div>
      {why && open ? (
        <div id={said} className="flex flex-col gap-3 text-muted-foreground">
          {why}
        </div>
      ) : null}
    </div>
  );
}

interface Folded {
  id: string;
  from: string;
  /** The first line of its text. */
  preview: string | null;
  at: ReactNode;
}

/**
 * A conversation, oldest first: each message folded to who sent it, its first line and when, but the one open
 * (`children`, a `MessageHead` over its text), which a press on a folded one moves to it. One message alone is the open one.
 */
export function MessageStack({
  messages,
  open,
  onOpen,
  children,
}: {
  messages: readonly Folded[];
  open: string;
  onOpen: (id: string) => void;
  children: ReactNode;
}) {
  const at = Math.max(
    messages.findIndex((m) => m.id === open),
    0,
  );
  const folded = (list: readonly Folded[]) =>
    list.length === 0 ? null : (
      <Table>
        <Heads>
          <Th>From</Th>
          <Th num>Received</Th>
        </Heads>
        <tbody>
          {list.map((m) => (
            <Tr key={m.id} onOpen={() => onOpen(m.id)}>
              <Td className="w-full max-w-0">
                <span className="flex items-baseline gap-3">
                  <span className="shrink-0 font-semibold">{m.from}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{m.preview}</span>
                </span>
              </Td>
              <Td num quiet>
                {m.at}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {folded(messages.slice(0, at))}
      <article className="flex min-w-0 flex-col gap-4">{children}</article>
      {folded(messages.slice(at + 1))}
    </div>
  );
}

/** Who wrote a message and when, over its text: the name, the address after it (not on a phone), the time at the right, who it went to under them. */
export function MessageHead({ from, address, at, to }: { from: ReactNode; address?: ReactNode; at: ReactNode; to?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-baseline gap-x-3">
        <span className="flex min-w-0 flex-1 items-baseline gap-x-2">
          <span className="name flex shrink-0 items-baseline gap-1.5">{from}</span>
          {address ? <span className="min-w-0 truncate text-sm text-muted-foreground max-sm:hidden">{address}</span> : null}
        </span>
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{at}</span>
      </div>
      {to ? <div className="text-sm text-muted-foreground">{to}</div> : null}
    </header>
  );
}

/** Writing in place under what it answers (Reply, Reply all, Forward): its fields and text, then Send and Discard (`actions`) on a line under them. */
export function ReplyBox({ label, actions, children }: { label: string; actions: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="mt-2 flex flex-col gap-4">
      {children}
      <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
    </section>
  );
}
