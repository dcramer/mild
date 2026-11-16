import { Dialog as Base } from '@base-ui/react/dialog';
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const ICON =
  'press flex size-(--control) shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground disabled:pointer-events-none disabled:opacity-35';

/**
 * One thing from a list, opened beside the list: it slides over from the right, as wide as three
 * quarters of the screen, and the list stays behind it. `onPrevious` and `onNext` step through the
 * list without closing; leave one out at either end. Covers the screen on a phone. Closes on Escape
 * or a press outside.
 *
 * A Dialog is for a form or a question; a Panel is for looking at, and acting on, one item of many.
 */
export function Panel({
  open,
  onClose,
  title,
  subtitle,
  position,
  onPrevious,
  onNext,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** Where this is in the list, in words: "3 of 12". */
  position?: string;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <Base.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-40 bg-background/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Base.Popup className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-(--frame) bg-card text-sm outline-none transition-transform duration-150 ease-out [--gutter:1rem] [--bleed:0px] data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none md:w-[min(75vw,80rem)] md:border-l">
          <header className="flex items-start gap-3 px-5 pt-4 pb-4 md:px-7">
            <div className="min-w-0 flex-1 pt-1">
              <Base.Title className="title break-words">{title}</Base.Title>
              {subtitle ? <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div> : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {position ? <span className="mr-2 hidden text-sm whitespace-nowrap text-muted-foreground tabular-nums sm:inline">{position}</span> : null}
              {onPrevious || onNext ? (
                <>
                  <button type="button" aria-label="Previous" className={ICON} disabled={!onPrevious} onClick={onPrevious}>
                    <ChevronUpIcon className="size-4" />
                  </button>
                  <button type="button" aria-label="Next" className={ICON} disabled={!onNext} onClick={onNext}>
                    <ChevronDownIcon className="size-4" />
                  </button>
                </>
              ) : null}
              <Base.Close aria-label="Close" className={ICON}>
                <XIcon className="size-4" />
              </Base.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 md:px-7">{children}</div>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}
