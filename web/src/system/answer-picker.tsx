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
 * Saying what something is: a dropdown that starts on sift's answer, and a check that commits it.
 * Choosing only chooses; the check commits, so agreeing is one press and a change is two. Once the choice
 * differs from where it started, the check is inked, the one ink allowed down a list, because something is
 * now waiting on the reader's press. `groups` run most likely first; `empty` is what shows when there is no
 * answer yet, and the check waits for a choice.
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
  /** sift's answer, where the dropdown starts. */
  value: string | null;
  groups: readonly (readonly Pick[])[];
  empty: ReactNode;
  onSubmit: (id: string) => void;
  busy?: boolean;
  className?: string;
  /** Last in the list, set apart: something to do instead of a choice, such as adding a label that does not exist yet. */
  extra?: { label: string; lead?: ReactNode; onSelect: () => void };
}) {
  const [chosen, setChosen] = useState<string | null>(value);
  const all = groups.flat();
  const current = all.find((p) => p.id === chosen);
  const changed = chosen !== value;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Base.Root
        items={all.map((p) => ({ value: p.id, label: p.label }))}
        value={chosen}
        onValueChange={(next) => (next === EXTRA ? extra?.onSelect() : next !== null && setChosen(next))}
      >
        <Base.Trigger
          aria-label={label}
          className="press inline-flex h-(--control) min-w-0 flex-1 cursor-pointer items-center gap-2 pr-2 pl-3 text-sm whitespace-nowrap select-none border border-transparent bg-(--fill) hover:bg-(--fill-strong) data-popup-open:bg-(--fill-strong)"
        >
          {current ? (
            <>
              {current.lead}
              <span className="truncate">{current.label}</span>
            </>
          ) : (
            empty
          )}
          <ChevronDownIcon aria-hidden className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        </Base.Trigger>
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
      </Base.Root>
      <Button
        aria-label={current ? `${changed ? 'Save' : 'Agree'}: ${current.label}` : 'Choose what it is first'}
        disabled={chosen === null}
        busy={busy ?? false}
        onClick={() => chosen !== null && onSubmit(chosen)}
        className={cn('px-2', changed && 'bg-foreground text-background hover:bg-foreground/85')}
      >
        <CheckIcon aria-hidden />
      </Button>
    </span>
  );
}
