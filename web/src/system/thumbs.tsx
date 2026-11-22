'use client';
import type { ReactNode } from 'react';
import { AboveToasts } from './toast.tsx';

/** A press of a `ThumbBar`. */
export interface Thumb {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
}

/**
 * On a phone, what can be done with what a screen shows, along the bottom of the screen where a thumb is: wide presses
 * side by side, each an icon and a word, with toasts above them. Wider, it is not drawn, and the screen has the same
 * presses where it puts them (the reader's bar). It holds its own height at the end of the page, so nothing ends under it.
 */
export function ThumbBar({ thumbs }: { thumbs: readonly Thumb[] }) {
  return (
    <>
      <div aria-hidden className="hidden h-[calc(3rem+var(--safe-bottom))] phone:block" />
      <AboveToasts className="fixed inset-x-0 bottom-0 z-30 hidden border-t border-(--rule) bg-background pr-(--safe-right) pb-(--safe-bottom) pl-(--safe-left) phone:flex">
        {thumbs.map((t) => (
          <button
            key={t.label}
            type="button"
            disabled={t.disabled}
            onClick={t.onPress}
            className="press inline-flex h-12 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 text-sm font-semibold text-foreground/80 select-none active:bg-(--fill) disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-[1.15em] [&_svg]:shrink-0"
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </AboveToasts>
    </>
  );
}
