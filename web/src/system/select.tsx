import { Select as Base } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * One choice from a short list. `options` are `[value, label]` pairs; `label` names the control for screen readers.
 * `icons` gives a choice its icon, before its label in the list and once chosen (an action's).
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  icons,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  disabled?: boolean;
  icons?: Partial<Record<T, ReactNode>>;
}) {
  const items = options.map(([v, l]) => ({ value: v, label: l }));
  return (
    <Base.Root items={items} value={value} disabled={disabled ?? false} onValueChange={(next) => next !== null && onChange(next)}>
      <Base.Trigger
        aria-label={label}
        className="press inline-flex h-(--control) max-w-full cursor-pointer items-center justify-between gap-1.5 pr-2 pl-3 text-sm whitespace-nowrap select-none data-disabled:pointer-events-none data-disabled:opacity-45 border border-transparent bg-(--fill) hover:bg-(--fill-strong) data-popup-open:bg-(--fill-strong)"
      >
        {/* Down a pixel, as a button's words sit: Karla centred on its box reads high. */}
        <span className="relative top-px flex min-w-0 items-center gap-2">
          {icons?.[value] ?? null}
          <span className="truncate">
            <Base.Value />
          </span>
        </span>
        <Base.Icon render={<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />} />
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner sideOffset={4} align="start" alignItemWithTrigger={false} className="z-50">
          <Base.Popup className="sheet max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto bg-popover p-1 text-sm outline-none">
            <Base.List>
              {items.map((item) => (
                <Base.Item
                  key={item.value}
                  value={item.value}
                  className="relative flex cursor-pointer data-disabled:cursor-default items-center py-1.5 pr-8 pl-2 whitespace-nowrap outline-none select-none data-highlighted:bg-(--fill-strong) pointer-coarse:min-h-11"
                >
                  {icons?.[item.value] ? <span className="mr-2 flex">{icons[item.value]}</span> : null}
                  <Base.ItemText>{item.label}</Base.ItemText>
                  <Base.ItemIndicator className="absolute right-2 flex items-center">
                    <CheckIcon className="size-3.5" />
                  </Base.ItemIndicator>
                </Base.Item>
              ))}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
