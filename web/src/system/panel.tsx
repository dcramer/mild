import { Dialog as Base } from '@base-ui/react/dialog';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { Control, ControlBar } from './controls.tsx';
import { KeyLayer, keyName, useHintsShown, useShortcut } from './keys.tsx';
import { Kbd } from './type.tsx';

const ICON =
  'press flex h-(--control) min-w-(--control) shrink-0 gap-1.5 px-2 cursor-pointer items-center justify-center text-muted-foreground hover:bg-(--fill) hover:text-foreground disabled:pointer-events-none disabled:opacity-35';

/**
 * One thing from a list, opened beside the list: it slides over from the right, as wide as three
 * quarters of the screen, and the list stays behind it. `onPrevious` and `onNext` step through the
 * list without closing; leave one out at either end. `narrow` for a short form. Covers the screen on a phone. Closes on Escape
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
  narrow,
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
  /** For one item that is a few facts and a short form (a label), rather than something to read beside the list. */
  narrow?: boolean;
  children: ReactNode;
}) {
  const shortcuts = useHintsShown();
  const popup = useRef<HTMLDivElement>(null);
  const stepping = onPrevious !== undefined || onNext !== undefined;
  return (
    <Base.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-40 bg-background/60 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        {/* The panel takes the focus itself, not its first button, so Enter answers and does not press Next. */}
        <Base.Popup
          ref={popup}
          tabIndex={-1}
          initialFocus={popup}
          className={`focus-within-shown fixed inset-y-0 right-0 z-50 flex w-full flex-col border-(--frame) bg-card text-sm outline-none transition-transform duration-150 ease-out [--gutter:1rem] [--bleed:0px] data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none md:border-l ${narrow ? 'md:w-[min(44rem,100vw)]' : 'md:w-[min(75vw,80rem)]'}`}
        >
          <KeyLayer moves>
            <header className="flex items-start gap-3 px-5 pt-4 pb-4 md:px-7">
              <div className="min-w-0 flex-1 pt-1">
                <Base.Title className="title break-words">{title}</Base.Title>
                {subtitle ? <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div> : null}
              </div>
              {/* Closing has a control in the footer; the corner keeps one for a panel with no footer, and on a phone, where the footer steps. */}
              <Base.Close aria-label="Close" aria-keyshortcuts="Escape" className={stepping ? `${ICON} md:hidden` : ICON}>
                <XIcon className="size-4" />
                {shortcuts && !stepping ? <Kbd className="hidden md:inline-flex">{keyName('Escape')}</Kbd> : null}
              </Base.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 md:px-7">{children}</div>
            {stepping ? (
              <ControlBar start={position} className="border-t border-(--rule) px-3 py-1.5 md:px-5">
                <Step label="Previous" shortcut="k" onPress={onPrevious} icon={<ChevronLeftIcon aria-hidden className="size-4" />} />
                <Step
                  label="Next"
                  shortcut="j"
                  onPress={onNext}
                  icon={<ChevronRightIcon aria-hidden className="size-4" />}
                  iconAfter
                  className="max-md:order-3"
                />
                <Base.Close render={<Control keys={['Escape']} label="Close" className="max-md:hidden" />} />
              </ControlBar>
            ) : null}
          </KeyLayer>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}

/** Previous or next in the list the panel was opened from. Its key works only while there is somewhere to go. */
function Step({
  label,
  shortcut,
  onPress,
  icon,
  iconAfter,
  className,
}: {
  label: string;
  shortcut: string;
  onPress: (() => void) | undefined;
  icon: ReactNode;
  iconAfter?: boolean;
  className?: string;
}) {
  void useShortcut(shortcut, label, () => onPress?.(), { enabled: onPress !== undefined });
  return (
    <Control
      keys={[shortcut]}
      label={label}
      icon={icon}
      iconAfter={iconAfter ?? false}
      disabled={!onPress}
      onClick={() => onPress?.()}
      {...(className ? { className } : {})}
    />
  );
}
