'use client';
import { Combobox } from '@base-ui/react/combobox';
import { XIcon } from 'lucide-react';
import { type Ref, useEffect, useRef, useState } from 'react';
import { type Party, type Recipient, readRecipients, sameAddress, typed } from '@/lib/addresses';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip.tsx';

/** `list` and what was typed after it, each address once. */
export const withTyped = (list: readonly Recipient[], typedText: string): Recipient[] => [
  ...list,
  ...readRecipients(typedText).filter((r, i, all) => !list.some((v) => sameAddress(v, r)) && all.findIndex((o) => sameAddress(o, r)) === i),
];

/** A pause in typing before suggestions are asked for, so a word typed quickly is one request. */
const PAUSE_MS = 120;

/**
 * A draft's To, Cc or Bcc, bare on its `DraftLine`: who it goes to as chips (the name, or the address where there is
 * none, which a `Tooltip` shows), then what is being typed. A comma, semicolon, Enter, Tab or leaving the field makes
 * what was typed chips; Backspace at the start takes the last one off. A chip that is not an address is underlined in
 * red until it is pressed, which puts it back to type. As an address is typed, `suggest` is asked who it may be: a
 * pick from them, by the keys or the pointer, is a chip. What is typed is the draft's (`text`), so a press of Send can
 * take what has not become a chip yet.
 */
export function Recipients({
  label,
  value,
  onChange,
  text,
  onText,
  suggest,
  inputRef,
}: {
  label: string;
  value: readonly Recipient[];
  onChange: (next: Recipient[]) => void;
  text: string;
  onText: (text: string) => void;
  suggest: (typed: string, signal: AbortSignal) => Promise<Party[]>;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const setText = onText;
  const [found, setFound] = useState<Party[]>([]);
  const [open, setOpen] = useState(false);
  const highlighted = useRef<Party | undefined>(undefined);
  const chosen = (p: Party) => value.some((v) => sameAddress(v, p));

  useEffect(() => {
    const words = text.trim();
    if (words === '') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggest(words, controller.signal).then(
        (parties) => setFound(parties),
        () => {},
      );
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, suggest]);

  /** What was typed, as chips, the ones already there kept once. */
  const commit = (typedText: string, rest = '') => {
    onChange(withTyped(value, typedText));
    setText(rest);
    if (rest === '') setFound([]);
  };
  const items = text.trim() === '' ? [] : found.filter((p) => !chosen(p));

  return (
    <Combobox.Root<Party, true>
      multiple
      items={items}
      filter={null}
      value={value}
      inputValue={text}
      open={open && items.length > 0}
      onOpenChange={setOpen}
      itemToStringLabel={typed}
      isItemEqualToValue={sameAddress}
      onItemHighlighted={(item) => {
        highlighted.current = item;
      }}
      onValueChange={(next) => {
        onChange(next);
        setText('');
        setFound([]);
      }}
      onInputValueChange={(next, { reason }) => {
        if (reason === 'item-press') return;
        // Pasted or typed: everything up to the last separator is chips at once.
        const cut = Math.max(next.lastIndexOf(','), next.lastIndexOf(';'));
        if (cut >= 0 && !/"[^"]*$/.test(next.slice(0, cut))) commit(next.slice(0, cut).replaceAll(';', ','), next.slice(cut + 1).trimStart());
        // Space before an address is never part of it: a comma typed with a space after it starts the next one clean.
        else setText(next.trimStart());
      }}
    >
      <Combobox.Chips className="flex min-h-(--control) min-w-0 flex-1 flex-wrap items-center gap-1 py-1" aria-label={value.length > 0 ? label : undefined}>
        {value.map((r) => (
          <Combobox.Chip
            key={r.address.toLowerCase()}
            aria-label={r.wrong ? `${r.address}, not an address` : typed(r)}
            aria-description="Press Backspace or Delete to remove"
            className="group/chip flex h-6 max-w-full items-center gap-0.5 rounded-(--corner) bg-(--fill) pr-0.5 pl-2 text-sm outline-none focus-within:bg-(--fill-strong) data-highlighted:bg-(--fill-strong) pointer-coarse:h-8"
          >
            <Tooltip says={r.name && !r.wrong ? r.address : null} className="min-w-0 truncate">
              <button
                type="button"
                tabIndex={-1}
                className={cn('max-w-full truncate', r.wrong && 'underline decoration-destructive decoration-wavy underline-offset-4')}
                // Pressed, a wrong one goes back to be typed again.
                onClick={() => {
                  if (!r.wrong) return;
                  onChange(value.filter((v) => v !== r));
                  setText(r.address);
                }}
              >
                {r.name ?? r.address}
              </button>
            </Tooltip>
            <Combobox.ChipRemove
              aria-label={`Remove ${r.name ?? r.address}`}
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-(--corner) text-muted-foreground hover:bg-(--fill-strong) hover:text-foreground pointer-coarse:size-7"
            >
              <XIcon className="size-3" aria-hidden />
            </Combobox.ChipRemove>
          </Combobox.Chip>
        ))}
        <Combobox.Input
          ref={inputRef}
          aria-label={label}
          autoComplete="off"
          // A phone's keyboard for addresses: with @ on it, and nothing capitalised or corrected.
          inputMode="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none pointer-coarse:text-base"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !(event.metaKey || event.ctrlKey) && highlighted.current === undefined && text.trim() !== '') {
              event.preventDefault();
              commit(text);
            } else if (event.key === 'Tab' && text.trim() !== '') commit(text);
          }}
          onBlur={() => {
            if (text.trim() !== '') commit(text);
          }}
        />
      </Combobox.Chips>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="z-50">
          <Combobox.Popup className="sheet max-h-(--available-height) w-[min(24rem,var(--available-width))] overflow-y-auto bg-popover p-1 text-sm outline-none">
            <Combobox.List>
              {(p: Party) => (
                <Combobox.Item
                  key={p.address.toLowerCase()}
                  value={p}
                  className="flex cursor-pointer flex-col px-2 py-1.5 outline-none select-none data-highlighted:bg-(--fill-strong) pointer-coarse:min-h-11"
                >
                  <span className="truncate">{p.name ?? p.address}</span>
                  {p.name ? <span className="truncate text-muted-foreground">{p.address}</span> : null}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
