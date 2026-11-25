'use client';
import { Dialog as Base } from '@base-ui/react/dialog';
import { CheckIcon } from 'lucide-react';
import { Fragment, type ReactNode, useRef } from 'react';
import { useBackCloses } from '@/lib/params.ts';
import { type Ending, type Pick, endingOf } from './answer-picker.tsx';
import { Button } from './button.tsx';
import { Backdrop, useLayerOpen } from './layer.tsx';

/**
 * On a phone, saying what one conversation is (Inbox's swipe right): a sheet risen from the bottom with every label, Leave
 * in inbox first and set apart, then Mild's answer with its meter, each with what it does, ending as every label picker
 * does (`Ending`), and Cancel under the thumb. A press on a label is the answer and closes it; a press above it, Back or
 * Cancel closes it with nothing said.
 */
export function LabelSheet({
  open,
  onClose,
  who,
  subject,
  value,
  groups,
  onPick,
  ending,
}: {
  open: boolean;
  onClose: () => void;
  who: ReactNode;
  subject: ReactNode;
  value: string | null;
  groups: readonly (readonly (Pick & { does?: ReactNode })[])[];
  onPick: (id: string) => void;
  ending: Ending;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const layer = useLayerOpen(open, onClose);
  useBackCloses(open, () => layer.root.onOpenChange(false));
  const pick = (id: string) => {
    onPick(id);
    layer.root.onOpenChange(false);
  };
  const shown = groups.filter((g) => g.length > 0);
  return (
    <Base.Root {...layer.root}>
      <Base.Portal>
        <Backdrop still={layer.still} />
        {/* The sheet takes the focus itself, not its first label, which would show as chosen. */}
        <Base.Popup
          ref={popup}
          tabIndex={-1}
          initialFocus={popup}
          data-still={layer.still || undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85svh] flex-col rounded-t-[10px] border-t border-(--frame) bg-card pb-(--safe-bottom) [--surface:var(--card)] text-sm outline-none transition-transform duration-(--motion-sheet) ease-out data-ending-style:pointer-events-none data-ending-style:translate-y-full data-starting-style:translate-y-full data-still:transition-none"
        >
          <header className="px-4 pt-4 pb-2">
            <Base.Title className="name truncate">{who}</Base.Title>
            <Base.Description className="mt-0.5 truncate text-muted-foreground">{subject}</Base.Description>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ul className="pb-1">
              {shown.map((group, index) => (
                <Fragment key={group[0].id}>
                  {index > 0 ? <li aria-hidden className="mx-4 my-1 border-t border-(--rule)" /> : null}
                  {group.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-current={p.id === value}
                        onClick={() => pick(p.id)}
                        className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-base select-none active:bg-(--fill-strong)"
                      >
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <span className="truncate">{p.label}</span>
                          {p.lead ? <span aria-hidden>{p.lead}</span> : null}
                        </span>
                        {p.does ? <span className="shrink-0 text-sm text-muted-foreground">{p.does}</span> : null}
                        {value === null ? null : (
                          <span className="flex w-4 shrink-0 justify-center">{p.id === value ? <CheckIcon aria-hidden className="size-4" /> : null}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </Fragment>
              ))}
              <li aria-hidden className="mx-4 my-1 border-t border-(--rule)" />
              {endingOf(ending).map(({ key, label, icon: Icon, onSelect }) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => {
                      layer.root.onOpenChange(false);
                      onSelect();
                    }}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-base text-muted-foreground select-none active:bg-(--fill-strong)"
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-(--rule) px-4 py-2">
            <Button size="lg" className="w-full" onClick={() => layer.root.onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}
