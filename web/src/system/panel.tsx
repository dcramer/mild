import { Dialog as Base } from '@base-ui/react/dialog';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { Control, ControlBar } from './controls.tsx';
import { KeyLayer, useShortcut } from './keys.tsx';
import { Backdrop, LayerBody, LayerHeader, useLayerOpen } from './layer.tsx';

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
  keys = false,
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
  /** K and J step through the list, and the footer shows them. Only for a list someone works through (docs/DESIGN.md, Keys). */
  keys?: boolean;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const stepping = onPrevious !== undefined || onNext !== undefined;
  return (
    <Base.Root {...useLayerOpen(open, onClose)}>
      <Base.Portal>
        <Backdrop />
        {/* The panel takes the focus itself, not its first button, so Enter answers and does not press Next. */}
        <Base.Popup
          ref={popup}
          tabIndex={-1}
          initialFocus={popup}
          className={`focus-within-shown fixed inset-y-0 right-0 z-50 flex w-full flex-col border-(--frame) bg-card [--surface:var(--card)] text-sm outline-none transition-transform duration-150 ease-out data-ending-style:translate-x-full data-starting-style:translate-x-full motion-reduce:transition-none md:border-l ${narrow ? 'md:w-[min(44rem,100vw)]' : 'md:w-[min(75vw,80rem)]'}`}
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
