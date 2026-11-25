'use client';
import { Select as Base } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon, PlusIcon, TagIcon, WorkflowIcon } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils.ts';
import { Button } from './button.tsx';

/**
 * What every list of labels for one message ends with, set apart, in this order: a label of the person's own, for mail
 * none of theirs fits, and a rule started on the message, for mail like it. Every picker and `LabelSheet` draws them.
 */
export interface Ending {
  onAdd: () => void;
  onRule: () => void;
}

export const endingOf = ({ onAdd, onRule }: Ending) =>
  [
    { key: 'add', label: 'Add a label…', icon: PlusIcon, onSelect: onAdd },
    { key: 'rule', label: 'Make a rule…', icon: WorkflowIcon, onSelect: onRule },
  ] as const;

/** An ending's value in the list: never a choice, so never anyone's label id. */
const ENDING = '\u0000ending:';
const endingAt = (value: string | null, ending: Ending) =>
  value?.startsWith(ENDING) ? endingOf(ending).find((e) => e.key === value.slice(ENDING.length)) : undefined;

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
 * In the reader's toolbar (`size="toolbar"`) it is drawn as `LabelPick` is there, its tag and no fill, with the check an icon.
 */
export function AnswerPicker({
  label,
  value,
  groups,
  empty,
  onSubmit,
  busy,
  className,
  ending,
  size = 'row',
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
  ending: Ending;
  size?: 'row' | 'toolbar';
}) {
  const [chosen, setChosen] = useState<string | null>(value);
  const toolbar = size === 'toolbar';
  const all = groups.flat();
  const current = all.find((p) => p.id === chosen);
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Base.Root
        items={all.map((p) => ({ value: p.id, label: p.label }))}
        value={chosen}
        onValueChange={(next, { reason }) => {
          const press = endingAt(next, ending);
          if (press) return press.onSelect();
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
          className={cn(
            'press inline-flex h-(--control) min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm whitespace-nowrap select-none',
            toolbar
              ? 'px-3 text-foreground/75 hover:bg-(--fill) hover:text-foreground data-popup-open:bg-(--fill) data-popup-open:text-foreground'
              : 'border border-transparent bg-(--fill) pr-2 pl-3 hover:bg-(--fill-strong) data-popup-open:bg-(--fill-strong)',
          )}
        >
          {toolbar ? <TagIcon aria-hidden className="size-4 shrink-0" /> : null}
          {/* The meter stands on the label's baseline, and both sit a pixel down, as a button's words do. */}
          <span className="relative top-px flex min-w-0 items-baseline gap-2">
            {current ? (
              <>
                {current.lead}
                <span className="truncate">{current.label}</span>
              </>
            ) : (
              // Supporting, not a row's faint ink, which is too faint on the button's fill to read (axe, `e2e/page.spec.ts`).
              <span className="truncate text-supporting">{empty}</span>
            )}
          </span>
          <ChevronDownIcon aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground', !toolbar && 'ml-auto')} />
        </Base.Trigger>
        <Choices groups={groups} ending={ending} />
      </Base.Root>
      <Button
        aria-label={current ? `Agree: ${current.label}` : 'Choose what it is'}
        disabled={chosen === null}
        busy={busy ?? false}
        onClick={() => chosen !== null && void Promise.resolve(onSubmit(chosen)).catch(() => undefined)}
        {...(toolbar ? { variant: 'quiet' as const, size: 'icon' as const } : { className: 'px-2' })}
      >
        <CheckIcon aria-hidden />
      </Button>
    </span>
  );
}

/**
 * What a message is, changed in place where it is read: on the block a row's presses sit on when the row is pointed at
 * (`RowPresses`' `lead`), or in the reader's toolbar (`ReaderBar`'s `label`, `size="toolbar"`, as tall as its icons). The
 * meter and the label, or Unlabelled, and a chevron. Picking saves it at once, with no check, since there is nothing to
 * agree to; picking again is the undo. `onSubmit` settles as the save does, and on failure the pick goes back. Its list
 * ends as `AnswerPicker`'s does (`Ending`).
 */
export function LabelPick({
  label,
  value,
  groups,
  onSubmit,
  size = 'row',
  ending,
}: {
  label: string;
  value: string | null;
  groups: readonly (readonly Pick[])[];
  onSubmit: (id: string) => Promise<unknown>;
  size?: 'row' | 'toolbar';
  ending: Ending;
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
        const press = endingAt(next, ending);
        if (press) return press.onSelect();
        if (next === null || reason !== 'item-press' || next === chosen) return;
        const was = chosen;
        setChosen(next);
        onSubmit(next).catch(() => setChosen(was));
      }}
    >
      <Base.Trigger
        aria-label={label}
        className={cn(
          'press inline-flex min-w-0 cursor-pointer items-center gap-2 text-sm',
          size === 'toolbar' ? 'h-(--control) px-3' : 'h-7 px-2',
          size === 'toolbar' ? 'hover:bg-(--fill) data-popup-open:bg-(--fill)' : 'hover:bg-(--fill-strong) data-popup-open:bg-(--fill-strong)',
          'whitespace-nowrap text-foreground/75 select-none hover:text-foreground data-popup-open:text-foreground',
        )}
      >
        {size === 'toolbar' ? <TagIcon aria-hidden className="size-4 shrink-0" /> : null}
        {/* The meter stands on the label's baseline, and both sit a pixel down, as a button's words do. */}
        <span className="relative top-px flex min-w-0 items-baseline gap-2">
          {current ? (
            <>
              {current.lead}
              <span className="truncate">{current.label}</span>
            </>
          ) : (
            'Unlabelled'
          )}
        </span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </Base.Trigger>
      <Choices groups={groups} ending={ending} />
    </Base.Root>
  );
}

/** The open list of either picker: its groups set apart, and its `Ending` last. */
function Choices({ groups, ending }: { groups: readonly (readonly Pick[])[]; ending: Ending }) {
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
            <Base.Separator className="my-1 border-t border-(--rule)" />
            {endingOf(ending).map(({ key, label, icon: Icon }) => (
              <Base.Item
                key={key}
                value={`${ENDING}${key}`}
                className="relative flex cursor-pointer items-center gap-2.5 py-1.5 pr-8 pl-2 whitespace-nowrap text-muted-foreground outline-none select-none data-highlighted:bg-(--fill-strong) data-highlighted:text-foreground pointer-coarse:min-h-11"
              >
                <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
                  <Icon className="size-3.5" />
                </span>
                <Base.ItemText>{label}</Base.ItemText>
              </Base.Item>
            ))}
          </Base.List>
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}
