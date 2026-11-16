import { cn } from '@/lib/utils';
import { Kbd } from './type.tsx';

const CHOICE =
  'press inline-flex h-(--control) cursor-pointer items-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-45 aria-checked:bg-foreground aria-checked:text-background aria-pressed:bg-foreground aria-pressed:text-background';

/**
 * A few choices laid out to be seen at once, one of them on (inked), where a `Select` would hide them:
 * what a message is, where a sender stands. `numbered` shows the number key that picks each of the first
 * nine; the view binds the keys. With `clearable` pressing the one that is on turns it off, so none is on.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  numbered,
  clearable,
  disabled,
}: {
  label: string;
  value: T | null;
  options: readonly (readonly [T, string])[];
  onChange: (value: T | null) => void;
  numbered?: boolean;
  clearable?: boolean;
  disabled?: boolean;
}) {
  return (
    <div role={clearable ? 'group' : 'radiogroup'} aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([key, text], index) => {
        const on = key === value;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            {...(clearable ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on })}
            className={cn(CHOICE, !on && 'bg-(--fill) hover:bg-(--fill-strong)')}
            onClick={() => onChange(clearable && on ? null : key)}
          >
            {numbered && index < 9 ? <Kbd className={cn('hidden md:inline', on && 'text-background/60')}>{index + 1}</Kbd> : null}
            {text}
          </button>
        );
      })}
    </div>
  );
}
