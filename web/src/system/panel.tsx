'use client';
import { Dialog as Base } from '@base-ui/react/dialog';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { Control, ControlBar } from './controls.tsx';
import { KeyLayer, useShortcut } from './keys.tsx';
import { Backdrop, LayerBody, LayerHeader, useLayerOpen } from './layer.tsx';
import { rowHolding } from './table.tsx';

/**
 * One thing from a list, opened beside the list: it slides over from the right, as wide as three
 * quarters of the screen, and the list stays behind it. Never narrower than a 600px email beside the
 * message panel's right column, so on a smaller screen it covers the screen. `onPrevious` and `onNext` step through the
 * list without closing; leave one out at either end. `narrow` for a short form. Covers the screen on a phone. Closes on Escape
 * or a press outside.
 *
 * A Dialog is for a form or a question; a Panel is for looking at, and acting on, one item of many.
 */
export function Panel({
  open,
  onClose,
  onClosing,
  title,
  subtitle,
  position,
  onPrevious,
  onNext,
  narrow,
  keys = false,
  returnTo,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The reader dismissed it, and it is sliding away; `onClose` follows once it has. */
  onClosing?: () => void;
  title: string;
  subtitle?: ReactNode;
  /** Where this is in the list, in words: "3 of 12". */
  position?: string;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  /** For one item that is a few facts and a short form (a label), rather than something to read beside the list. */
  narrow?: boolean;
  /** K and J step through the list, and the footer shows them. Only for a list someone works through (docs/design.md, Keys). */
  keys?: boolean;
  /** What it shows, as the list's rows name it (`holds` on a `Tr`): closing goes back to that row, wherever it was opened from. */
  returnTo?: string;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const stepping = onPrevious !== undefined || onNext !== undefined;
  return (
    <Base.Root {...useLayerOpen(open, onClose, onClosing)}>
      <Base.Portal>
        <Backdrop />
        {/* The panel takes the focus itself, not its first button, which Enter would press. */}
        <Base.Popup
          ref={popup}
          tabIndex={-1}
          initialFocus={popup}
          finalFocus={() => (returnTo === undefined ? null : rowHolding(returnTo)) ?? true}
          className={`focus-within-shown fixed inset-y-0 right-0 z-50 flex w-full flex-col border-(--frame) bg-card [--surface:var(--card)] text-sm outline-none transition-transform duration-150 ease-out data-ending-style:pointer-events-none data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none md:border-l ${narrow ? 'md:w-[min(44rem,100vw)]' : 'md:w-[min(max(75vw,66rem),80rem,100vw)]'}`}
        >
          <KeyLayer moves>
            <LayerHeader title={title} subtitle={subtitle} />
            <LayerBody>{children}</LayerBody>
            {stepping ? (
              <ControlBar start={position} className="border-t border-(--rule) px-3 py-1.5 md:px-4">
                <Step label="Previous" shortcut={keys ? 'k' : undefined} onPress={onPrevious} icon={<ChevronLeftIcon aria-hidden className="size-4" />} />
                <Step
                  label="Next"
                  shortcut={keys ? 'j' : undefined}
                  onPress={onNext}
                  icon={<ChevronRightIcon aria-hidden className="size-4" />}
                  iconAfter
                  className="max-md:order-3"
                />
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
  shortcut: string | undefined;
  onPress: (() => void) | undefined;
  icon: ReactNode;
  iconAfter?: boolean;
  className?: string;
}) {
  void useShortcut(shortcut, label, () => onPress?.(), { enabled: onPress !== undefined });
  return (
    <Control
      keys={shortcut ? [shortcut] : []}
      label={label}
      icon={icon}
      iconAfter={iconAfter ?? false}
      disabled={!onPress}
      onClick={() => onPress?.()}
      {...(className ? { className } : {})}
    />
  );
}
