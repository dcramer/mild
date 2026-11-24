'use client';
import { type ComponentProps, type ReactNode, useState } from 'react';
import type { AnswerLabel } from '@/components/answer.tsx';
import type { RuleStart } from '@/lib/rule-start.ts';
import type { Ending } from '@/system';
import { AddLabelsDialog } from './label-fields.tsx';
import { RuleDialog } from './rule-dialog.tsx';

/**
 * A label picker's `Ending` for one message, with the dialogs it opens: Add a label…, and Make a rule… started on
 * `start`, or by `openRule` on any other. Put `dialogs` where it outlives the picker, since a phone's sheet closes as either opens.
 */
export function useLabelEnding(
  labels: readonly AnswerLabel[],
  start: () => RuleStart,
  onAdded?: ComponentProps<typeof RuleDialog>['onAdded'],
): { ending: Ending; openRule: (start: RuleStart) => void; dialogs: ReactNode } {
  const [adding, setAdding] = useState(false);
  const [ruling, setRuling] = useState<RuleStart | null>(null);
  return {
    ending: { onAdd: () => setAdding(true), onRule: () => setRuling(start()) },
    openRule: setRuling,
    dialogs: (
      <>
        {adding ? <AddLabelsDialog onClose={() => setAdding(false)} onSaved={() => setAdding(false)} /> : null}
        {ruling ? <RuleDialog labels={labels} start={ruling} onClose={() => setRuling(null)} onAdded={onAdded} /> : null}
      </>
    ),
  };
}
