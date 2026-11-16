import { Menu as Base } from '@base-ui/react/menu';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button.tsx';

export interface Choice {
  id: string;
  label: string;
  /** Before the label, such as a `Meter`. */
  lead?: ReactNode;
  /** A way out rather than an answer, in a lighter ink. */
  quiet?: boolean;
  onSelect: () => void;
}

/**
 * One answer to press, and the others behind a caret. The main half says what it is and carries a check
 * when pressing it agrees (`confirm`); the caret opens the other choices in groups, most likely first.
 * The answer to a suggestion: what sift says, and what else it might be.
 */
export function SplitButton({
  label,
  menuLabel,
  onPress,
  groups,
  confirm = true,
  busy,
  shortcut,
  className,
  children,
}: {
  /** Names the main half for a screen reader: "Agree: Marketing". */
  label: string;
  /** Names the caret: "Something else". */
  menuLabel: string;
  onPress: () => void;
  groups: readonly (readonly Choice[])[];
  confirm?: boolean;
  busy?: boolean;
  shortcut?: { key: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn('group/split inline-flex items-stretch gap-px', className)}>
      <Button
        aria-label={label}
        busy={busy ?? false}
        onClick={onPress}
        {...(shortcut ? { shortcut } : {})}
        className="min-w-0 flex-1 justify-start rounded-r-none"
      >
        {children}
        {confirm ? <CheckIcon aria-hidden className="ml-auto text-muted-foreground/60 group-hover/split:text-foreground" /> : null}
      </Button>
      <Base.Root>
        <Base.Trigger
          aria-label={menuLabel}
          className="press flex h-(--control) w-8 shrink-0 cursor-pointer items-center justify-center rounded-l-none bg-(--fill) text-muted-foreground hover:bg-(--fill-strong) hover:text-foreground data-popup-open:bg-(--fill-strong) data-popup-open:text-foreground"
        >
          <ChevronDownIcon aria-hidden className="size-3.5" />
        </Base.Trigger>
        <Base.Portal>
          <Base.Positioner sideOffset={4} align="end" className="z-50">
            <Base.Popup className="sheet max-h-(--available-height) max-w-[calc(100vw-2rem)] min-w-60 overflow-y-auto bg-popover p-1 text-sm text-foreground outline-none">
              {groups
                .filter((group) => group.length > 0)
                .map((group, index) => (
                  <Fragment key={group[0]?.id ?? index}>
                    {index > 0 ? <Base.Separator className="my-1 border-t border-(--rule)" /> : null}
                    {group.map((choice) => (
                      <Base.Item
                        key={choice.id}
                        onClick={choice.onSelect}
                        className={cn(
                          'flex cursor-default items-center gap-2.5 px-2 py-1.5 outline-none select-none data-highlighted:bg-(--fill-strong) pointer-coarse:min-h-11',
                          choice.quiet && 'text-muted-foreground data-highlighted:text-foreground',
                        )}
                      >
                        <span aria-hidden className="flex w-3.5 shrink-0 justify-center">
                          {choice.lead}
                        </span>
                        {choice.label}
                      </Base.Item>
                    ))}
                  </Fragment>
                ))}
            </Base.Popup>
          </Base.Positioner>
        </Base.Portal>
      </Base.Root>
    </span>
  );
}
