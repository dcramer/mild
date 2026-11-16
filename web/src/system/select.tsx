import { Select as Base } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';

/** One choice from a short list. `options` are `[value, label]` pairs; `label` names the control for screen readers. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const items = options.map(([v, l]) => ({ value: v, label: l }));
  return (
    <Base.Root items={items} value={value} disabled={disabled ?? false} onValueChange={(next) => next !== null && onChange(next)}>
      <Base.Trigger
        aria-label={label}
        className="press inline-flex h-(--control) max-w-full cursor-pointer items-center justify-between gap-1.5 border border-(--frame) pr-2 pl-3 text-sm font-medium whitespace-nowrap select-none hover:border-foreground/30 data-disabled:pointer-events-none data-disabled:opacity-45 data-popup-open:border-foreground/45"
      >
        <span className="truncate">
          <Base.Value />
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
                  className="relative flex cursor-pointer data-disabled:cursor-default items-center py-1.5 pr-8 pl-2 whitespace-nowrap outline-none select-none data-highlighted:bg-(--fill-strong)"
                >
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
