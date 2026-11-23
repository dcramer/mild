'use client';
import { Select as Base } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button.tsx';

/** The value of `extra` in the list: never a choice, so never anyone's label id. */
const EXTRA = '\u0000extra';

export interface Pick {
  id: string;
  label: string;
  /** Before the label, such as a `Meter`. */
  lead?: ReactNode;
}

/**
 * Saying what something is: a dropdown that starts on Mild's answer, and a check that agrees with it.
 * Picking from the list is the answer, so agreeing is one press and a change is two. `groups` run most
 * likely first; `empty` is what shows, in quiet ink (down a list, the row's until it is the row the reader is on), when there is no answer yet, and the check is off.
 */
export function AnswerPicker({
  label,
  value,
  groups,
  empty,
  onSubmit,
  busy,
  className,
  extra,
}: {
  /** Names the dropdown for a screen reader: "What this message is". */
  label: string;
  /** Mild's answer, where the dropdown starts. */
  value: string | null;
  groups: readonly (readonly Pick[])[];
  empty: string;
  onSubmit: (id: string) => unknown;
  busy?: boolean;
  className?: string;
  /** Last in the list, set apart: something to do instead of a choice, such as adding a label that does not exist yet. */
  extra?: { label: string; lead?: ReactNode; onSelect: () => void };
}) {
  const [chosen, setChosen] = useState<string | null>(value);
  const all = groups.flat();
  const current = all.find((p) => p.id === chosen);
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Base.Root
        items={all.map((p) => ({ value: p.id, label: p.label }))}
        value={chosen}
        onValueChange={(next, { reason }) => {
          if (next === EXTRA) return extra?.onSelect();
          // Base UI also sets a value of its own accord (one no longer listed), which is no answer.
          if (next === null || reason !== 'item-press') return;
          const was = chosen;
          setChosen(next);
          // A save that resolves later goes back to what was chosen if it fails.
          void Promise.resolve(onSubmit(next)).catch(() => setChosen(was));
        }}
      >
        <Base.Trigger
          aria-label={label}
          className="press inline-flex h-(--control) min-w-0 flex-1 cursor-pointer items-center gap-2 pr-2 pl-3 text-sm whitespace-nowrap select-none border border-transparent bg-(--fill) hover:bg-(--fill-strong) data-popup-open:bg-(--fill-strong)"
        >
          {/* The meter stands on the label's baseline, and both sit a pixel down, as a button's words do. */}
          <span className="relative top-px flex min-w-0 items-baseline gap-2">
            {current ? (
              <>
                {current.lead}
                <span className="truncate">{current.label}</span>
              </>
            ) : (
              <span className="truncate text-muted-foreground group-hover/row:text-supporting group-focus-within/row:text-supporting">{empty}</span>
            )}
          </span>
          <ChevronDownIcon aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        </Base.Trigger>
        <Choices groups={groups} extra={extra} />
      </Base.Root>
      <Button
        aria-label={current ? `Agree: ${current.label}` : 'Choose what it is'}
        disabled={chosen === null}
        busy={busy ?? false}
        onClick={() => chosen !== null && void Promise.resolve(onSubmit(chosen)).catch(() => undefined)}
        className="px-2"
      >
        <CheckIcon aria-hidden />
      </Button>
    </span>
  );
}

/**
 * What a row's mail is, changed in place from the block its presses sit on when the row is pointed at (`RowPresses`'
 * `lead`): the meter and the label, or Unlabelled, and a chevron. Picking saves it at once, with no check, since there is
 * nothing to agree to; picking again is the undo. `onSubmit` settles as the save does, and on failure the pick goes back.
 */
export function LabelPick({
  label,
  value,
  groups,
  onSubmit,
}: {
  label: string;
  value: string | null;
  groups: readonly (readonly Pick[])[];
  onSubmit: (id: string) => Promise<unknown>;
}) {
  const [chosen, setChosen] = useState<string | null>(value);
  // A new value from Mild is followed in place: drawing the picker again would shut a list the reader has open.
  const [given, setGiven] = useState(value);
  if (value !== given) {
    setGiven(value);
    setChosen(value);
  }
  const all = groups.flat();
  const current = all.find((p) => p.id === chosen);
  return (
    <Base.Root
      items={all.map((p) => ({ value: p.id, label: p.label }))}
      value={chosen}
      onValueChange={(next, { reason }) => {
        if (next === null || reason !== 'item-press' || next === chosen) return;
        const was = chosen;
        setChosen(next);
        onSubmit(next).catch(() => setChosen(was));
      }}
    >
      <Base.Trigger
        aria-label={label}
        className="press inline-flex h-7 cursor-pointer items-center gap-2 px-2 text-sm whitespace-nowrap text-foreground/75 select-none hover:bg-(--fill-strong) hover:text-foreground data-popup-open:bg-(--fill-strong) data-popup-open:text-foreground"
      >
        {/* The meter stands on the label's baseline, and both sit a pixel down, as a button's words do. */}
        <span className="relative top-px flex items-baseline gap-2">
          {current ? (
            <>
              {current.lead}
              {current.label}
            </>
          ) : (
            'Unlabelled'
          )}
        </span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </Base.Trigger>
      <Choices groups={groups} />
    </Base.Root>
  );
}

/** The open list of either picker: its groups set apart, and `extra` last. */
function Choices({ groups, extra }: { groups: readonly (readonly Pick[])[]; extra?: { label: string; lead?: ReactNode; onSelect: () => void } | undefined }) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={4} align="start" alignItemWithTrigger={false} className="z-50">
        <Base.Popup className="sheet max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto bg-popover p-1 text-sm outline-none">
          <Base.List>
            {groups
              .filter((group) => group.length > 0)
              .map((group, index) => (
                <Fragment key={group[0]?.id ?? index}>
                  {index > 0 ? <Base.Separator className="my-1 border-t border-(--rule)" /> : null}
                  {group.map((p) => (
                    <Base.Item
                      key={p.id}
                      value={p.id}
                      className="relative flex cursor-pointer items-center gap-2.5 data-disabled:cursor-default py-1.5 pr-8 pl-2 whitespace-nowrap outline-none select-none data-highlighted:bg-(--fill-strong) pointer-coarse:min-h-11"
                    >
                      <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
                        {p.lead}
                      </span>
                      <Base.ItemText>{p.label}</Base.ItemText>
                      <Base.ItemIndicator className="absolute right-2 flex items-center">
                        <CheckIcon className="size-3.5" />
                      </Base.ItemIndicator>
                    </Base.Item>
                  ))}
                </Fragment>
              ))}
            {extra ? (
              <>
                <Base.Separator className="my-1 border-t border-(--rule)" />
                <Base.Item
                  value={EXTRA}
                  className="relative flex cursor-pointer items-center gap-2.5 py-1.5 pr-8 pl-2 whitespace-nowrap text-muted-foreground outline-none select-none data-highlighted:bg-(--fill-strong) data-highlighted:text-foreground pointer-coarse:min-h-11"
                >
                  <span aria-hidden className="flex w-3.5 shrink-0 justify-center [&_svg]:size-3.5">
                    {extra.lead}
                  </span>
                  <Base.ItemText>{extra.label}</Base.ItemText>
                </Base.Item>
              </>
            ) : null}
          </Base.List>
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}
