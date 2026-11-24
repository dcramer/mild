'use client';
import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils.ts';

const CHOICE =
  'press inline-flex h-(--control) cursor-pointer items-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-45 aria-checked:bg-foreground aria-checked:text-background aria-pressed:bg-foreground aria-pressed:text-background';

/**
 * A few choices laid out to be seen at once, one of them on (inked), where a `Select` would hide them:
 * what a message is, where a sender stands. With `clearable` pressing the one that is on turns it off, so none is on.
 *
 * `notes` sets them as rows instead, each with a quieter line saying what sets it apart, and a tick on the
 * one that is on: a model, with what it costs. Rows reach past their text like a table's.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  clearable,
  disabled,
  notes,
}: {
  label: string;
  value: T | null;
  options: readonly (readonly [T, string])[];
  onChange: (value: T | null) => void;
  clearable?: boolean;
  disabled?: boolean;
  notes?: Partial<Record<T, string>>;
}) {
  if (notes)
    return (
      <div role="radiogroup" aria-label={label} className="bleed">
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === value}
            disabled={disabled}
            className="row flex w-full cursor-pointer items-center gap-3 py-2.5 pr-[calc(var(--gutter)+var(--bleed))] pl-[calc(var(--gutter)+var(--bleed))] text-left hover:bg-(--fill) focus-visible:bg-(--fill-strong) disabled:pointer-events-none disabled:opacity-45"
            onClick={() => onChange(key)}
          >
            <span className="min-w-0 flex-1">
              <span className="name">{text}</span>
              {notes[key] ? <span className="mt-0.5 block text-sm text-muted-foreground">{notes[key]}</span> : null}
            </span>
            {key === value ? <CheckIcon aria-hidden className="size-4 shrink-0" /> : null}
          </button>
        ))}
      </div>
    );
  return (
    <div role={clearable ? 'group' : 'radiogroup'} aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map(([key, text]) => (
        <Choice
          key={key}
          text={text}
          on={key === value}
          clearable={clearable ?? false}
          disabled={disabled ?? false}
          onPress={() => onChange(clearable && key === value ? null : key)}
        />
      ))}
    </div>
  );
}

function Choice({ text, on, clearable, disabled, onPress }: { text: string; on: boolean; clearable: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      {...(clearable ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on })}
      className={cn(CHOICE, !on && 'bg-(--fill) hover:bg-(--fill-strong)')}
      onClick={onPress}
    >
      {text}
    </button>
  );
}
