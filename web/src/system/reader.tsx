'use client';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, EllipsisVerticalIcon, ReplyIcon } from 'lucide-react';
import { Fragment, type ReactNode, type Ref, createContext, useContext, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils.ts';
import { Button } from './button.tsx';
import { keyName, useShortcut } from './keys.tsx';
import { Menu } from './menu.tsx';
import { type Thumb, ThumbBar } from './thumbs.tsx';
import { Tooltip } from './tooltip.tsx';
import { Kbd } from './type.tsx';

/**
 * One message or conversation, opened from a list in the list's place, inside the frame: the bar (`ReaderBar`), the
 * subject as the page's heading, `answer` under it (a proposal's why), then the conversation and whatever answers it. `side` is a
 * column beside the conversation on a wide screen, and under it narrower, for what is said about the message rather
 * than in it. On a phone `thumbs` are its presses along the bottom of the screen (`ThumbBar`), in place of the bar's and
 * those under the conversation. It takes the focus as it opens, so Enter presses nothing and the keys are its own.
 */
export function Reader({
  ref,
  bar,
  title,
  answer,
  side,
  thumbs = NO_THUMBS,
  children,
}: {
  ref?: Ref<HTMLElement>;
  bar: ReactNode;
  title: ReactNode;
  answer?: ReactNode;
  side?: ReactNode;
  thumbs?: readonly Thumb[];
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
      {bar}
      <div className="flex flex-col gap-3 phone:gap-2">
        <h1 id={heading} className="heading subject wrap-anywhere">
          {title}
        </h1>
        {answer}
      </div>
      <div className={cn('mt-4', side && 'flex flex-col gap-12 xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start xl:gap-16')}>
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
        {side ? <aside className="flex min-w-0 flex-col gap-8">{side}</aside> : null}
      </div>
      {thumbs.length > 0 ? <ThumbBar thumbs={thumbs} /> : null}
    </section>
  );
}

const NO_THUMBS: readonly Thumb[] = [];
const NO_PRESSES: readonly Press[] = [];

interface Press {
  label: string;
  key: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
  icon?: ReactNode;
}

/** Presses on what the reader shows, each with its key, on one line: Reply, Reply all and Forward under the conversation. */
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
 * The top of the reader, a mail app's toolbar of icons, each named with its key when pointed at: back to the list (Esc),
 * the presses on what it shows, then after a rule what the message is (`label`: Mild's part of the reader, as the
 * reader's own toolbar holds it), and at the end where it is in the list, and previous and next (K and J, or ← and →).
 * On a phone the presses are the `Reader`'s `thumbs`, at the bottom of the screen, and `label` stays.
 */
export function ReaderBar({
  back,
  onBack,
  presses = NO_PRESSES,
  label,
  position,
  onPrevious,
  onNext,
}: {
  /** The list's name: "Inbox". */
  back: string;
  onBack: () => void;
  /** With an `icon` a press is drawn as that alone; without one, in words with its key (a proposal's Make the rule…). */
  presses?: readonly Press[];
  label?: ReactNode;
  /** "3 of 12". */
  position?: string | undefined;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}) {
  const stepping = onPrevious !== undefined || onNext !== undefined;
  return (
    <div className="flex items-center gap-x-1">
      <Named label={`Back to ${back}`} keys="Escape">
        <Button
          variant="quiet"
          size="icon"
          className="-ml-2.5"
          aria-label={`Back to ${back}`}
          shortcut={{ key: 'Escape', label: 'Back to the list' }}
          onClick={onBack}
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
      </Named>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {presses.length > 0 ? (
          <span className="flex items-center gap-1 phone:hidden">
            {presses.map((p) =>
              p.icon ? (
                <Named key={p.label} label={p.label} keys={p.key}>
                  <Button variant="quiet" size="icon" aria-label={p.label} shortcut={{ key: p.key, label: p.label }} disabled={p.disabled} onClick={p.onPress}>
                    {p.icon}
                  </Button>
                </Named>
              ) : (
                <Button key={p.label} {...(p.quiet ? { variant: 'quiet' as const } : {})} shortcut={p.key} disabled={p.disabled} onClick={p.onPress}>
                  {p.label}
                </Button>
              ),
            )}
          </span>
        ) : null}
        {label ? (
          <>
            {presses.length > 0 ? <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-(--rule) phone:hidden" /> : null}
            <span className="flex min-w-0 items-center gap-1">{label}</span>
          </>
        ) : null}
        {position ? <span className="ml-auto px-2 text-sm whitespace-nowrap text-muted-foreground tabular-nums phone:hidden">{position}</span> : null}
        {stepping && !position ? <span className="ml-auto" /> : null}
        {stepping && position ? <span className="ml-auto md:hidden" /> : null}
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

/** Previous or next in the list. Its keys work only while there is somewhere to go; the first is said when pointed at. */
function Step({ label, keys, onPress, icon }: { label: string; keys: readonly string[]; onPress: (() => void) | undefined; icon: ReactNode }) {
  void useShortcut(keys, label, () => onPress?.(), { enabled: onPress !== undefined });
  return (
    <Named label={label} keys={keys[0]}>
      <Button variant="quiet" size="icon" aria-label={label} aria-keyshortcuts={keys.join(' ')} disabled={!onPress} onClick={() => onPress?.()}>
        {icon}
      </Button>
    </Named>
  );
}

/** An icon in the toolbar, named with its key when pointed at. */
function Named({ label, keys, children }: { label: string; keys: string; children: ReactNode }) {
  return (
    <Tooltip
      says={
        <span className="flex items-center gap-2">
          {label}
          <Kbd>{keyName(keys)}</Kbd>
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}

/** A message of a conversation as `MessageStack` lists it. */
interface Listed {
  id: string;
  /** Who sent it, in words: its folded line, and what its presses are called. */
  from: string;
  /** The first line of its text. */
  preview: string | null;
  at: ReactNode;
  /** Its folded line is bold, as a mail app marks what is not read. */
  unread?: boolean;
}

/**
 * Past this many messages a conversation folds its middle into one "N more", keeping the first and the last two in
 * sight, so a long one opens on its end. Messages open in the middle stay out of it.
 */
const FOLDS_PAST = 5;
const KEPT_AT_END = 2;

/** What the head of an open message in a `MessageStack` can do: fold it again, named by its sender. */
const Opened = createContext<{ from: string; fold: (() => void) | null }>({ from: '', fold: null });

type Item = { open: Listed } | { folded: Listed } | { more: Listed[] };

/**
 * A conversation, oldest first, read by scrolling the page, laid out as Gmail lays one out: each message open
 * (`children` draws it, a `MessageHead` over its text) or folded to one line of who sent it, its first line and when,
 * and a long one's middle folded into one "N more" between rules. A press on a folded line opens it in place and a
 * press on an open one's head folds it, so several can be open at once. One message alone is open and stays so.
 */
export function MessageStack({
  messages,
  open,
  onToggle,
  children,
}: {
  messages: readonly Listed[];
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  children: (id: string) => ReactNode;
}) {
  const [whole, setWhole] = useState(false);
  const alone = messages.length === 1;
  const hides = (i: number) => !whole && messages.length > FOLDS_PAST && i > 0 && i < messages.length - KEPT_AT_END;
  const items: Item[] = [];
  for (const [i, m] of messages.entries()) {
    const last = items.at(-1);
    if (alone || open.has(m.id)) items.push({ open: m });
    else if (!hides(i)) items.push({ folded: m });
    else if (last && 'more' in last) last.more.push(m);
    else items.push({ more: [m] });
  }
  return (
    <div className="flex min-w-0 flex-col">
      {items.map((item) =>
        'open' in item ? (
          <article key={item.open.id} className="row flex min-w-0 flex-col gap-4 py-5 first:pt-1">
            <Opened value={{ from: item.open.from, fold: alone ? null : () => onToggle(item.open.id) }}>{children(item.open.id)}</Opened>
          </article>
        ) : 'folded' in item || item.more.length === 1 ? (
          <Folded key={'folded' in item ? item.folded.id : item.more[0].id} message={'folded' in item ? item.folded : item.more[0]} onToggle={onToggle} />
        ) : (
          <div key={`more/${item.more[0].id}`} className="flex items-center gap-3 py-2">
            <span aria-hidden className="h-px flex-1 bg-(--rule)" />
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setWhole(true)}
              className="cursor-pointer rounded-(--corner) px-2 text-sm font-semibold text-muted-foreground hover:bg-(--fill) hover:text-foreground"
            >
              {item.more.length} more
            </button>
            <span aria-hidden className="h-px flex-1 bg-(--rule)" />
          </div>
        ),
      )}
    </div>
  );
}

/** A folded message: one line, which a press opens in place. */
function Folded({ message, onToggle }: { message: Listed; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={() => onToggle(message.id)}
      className="row -mx-(--bleed) flex min-w-0 cursor-pointer items-baseline gap-3 px-(--bleed) py-3 text-left [--inset:var(--bleed)] hover:bg-(--fill)"
    >
      <span className={cn('shrink-0', message.unread ? 'font-semibold' : 'text-foreground/80')}>{message.from}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{message.preview}</span>
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{message.at}</span>
    </button>
  );
}

interface Answers {
  reply: () => void;
  all: () => void;
  forward: () => void;
}

/**
 * Who wrote a message and when, over its text: the name, the address after it (not on a phone), the time at the right,
 * who it went to under them (`to`: a To and a Cc row, the words in a column of their own). In a `MessageStack` of several, a press anywhere on it but a link folds the message.
 * `answers` puts Reply at its end, and Reply all and Forward in its ⋮ menu, for answering this message rather than the
 * newest; `more` adds to that menu what else can be done with the message (Show as text).
 */
export function MessageHead({
  from,
  address,
  at,
  to,
  answers,
  more = NO_MORE,
}: {
  from: ReactNode;
  address?: ReactNode;
  at: ReactNode;
  to?: readonly { label: 'To' | 'Cc'; who: ReactNode }[];
  answers?: Answers;
  more?: readonly { label: string; onSelect: () => void }[];
}) {
  const opened = useContext(Opened);
  // Laid over by the head's words, which let a press through to it but on a link or a button of their own.
  const through = 'pointer-events-none relative [&_a]:pointer-events-auto [&_button]:pointer-events-auto';
  const items = [
    ...(answers
      ? [
          { label: 'Reply all', onSelect: answers.all },
          { label: 'Forward', onSelect: answers.forward },
        ]
      : []),
    ...more,
  ];
  return (
    <header className="relative flex flex-col gap-1">
      {opened.fold ? (
        <button
          type="button"
          aria-expanded
          aria-label={`Fold the message from ${opened.from}`}
          onClick={opened.fold}
          className="absolute -inset-x-(--bleed) -inset-y-2 cursor-pointer hover:bg-(--fill)"
        />
      ) : null}
      <div className={cn('flex items-center gap-x-3', through)}>
        <span className="flex min-w-0 flex-1 items-baseline gap-x-2">
          <span className="name flex min-w-0 items-baseline gap-1.5 [&>a]:truncate">{from}</span>
          {address ? <span className="min-w-0 truncate text-sm text-muted-foreground max-sm:hidden">{address}</span> : null}
        </span>
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{at}</span>
        {answers || items.length > 0 ? (
          <span className="-my-1 -mr-2 flex shrink-0 items-center">
            {answers ? (
              <Tooltip says="Reply">
                <Button variant="quiet" size="icon" aria-label={`Reply to ${opened.from}`} onClick={answers.reply}>
                  <ReplyIcon aria-hidden />
                </Button>
              </Tooltip>
            ) : null}
            {items.length > 0 ? (
              <Menu
                label={answers ? 'Reply all, forward and more' : 'More'}
                align="end"
                trigger={
                  <span className="flex size-(--control) items-center justify-center text-foreground/75">
                    <EllipsisVerticalIcon aria-hidden className="size-[1.15em]" />
                  </span>
                }
                items={items}
              />
            ) : null}
          </span>
        ) : null}
      </div>
      {to && to.length > 0 ? (
        <dl className={cn('grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm', through)}>
          {to.map((row) => (
            <Fragment key={row.label}>
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 text-foreground/85">{row.who}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

const NO_MORE: readonly { label: string; onSelect: () => void }[] = [];
