'use client';
import { useState } from 'react';
import { type LabelSummary, api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/components/action.ts';
import { type ActionKey } from '@/lib/words.ts';
import { count, percent, plural } from '@/lib/format.ts';
import { Button, DeleteButton, Failure, Figure, Figures, Form, Panel, useToast } from '@/system';
import { LabelFields } from '@/components/label-fields.tsx';

/** Wrong often enough to look at: under 85% right, over at least ten answers. */
export const weak = (label: LabelSummary) => label.record.reviewed >= 10 && label.record.right / label.record.reviewed < 0.85;

/**
 * One label: how it is doing, then what it is and what happens to it, edited in place. The figures come
 * first because a label is usually opened for one of them: it is often wrong, or takes much of the mail.
 */
export function LabelPanel({
  label,
  mail,
  position,
  onPrevious,
  onNext,
  onClose,
  onSaved,
}: {
  label: LabelSummary;
  mail: number;
  position: string;
  onPrevious: (() => void) | undefined;
  onNext: (() => void) | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const remove = useAction();
  const initial = {
    name: label.name,
    description: label.description,
    disposition: label.disposition as ActionKey,
    markRead: label.markRead,
    unsubscribe: label.unsubscribe,
  };
  const [draft, setDraft] = useState(initial);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  const ready = changed && draft.name.trim() !== '';
  const { busy, error, run } = useAction();
  // No toast: the panel shows what was saved.
  const save = () => run(() => api.saveLabel(label.id, { ...draft, name: draft.name.trim(), description: draft.description.trim() }), onSaved);

  const actions =
    label.gmailLabel === null ? undefined : (
      <>
        <Button variant="ink" busy={busy} disabled={!ready} onClick={save}>
          Save
        </Button>
        {changed ? (
          <Button variant="quiet" onClick={() => setDraft(initial)}>
            Undo changes
          </Button>
        ) : null}
        <Failure>{error}</Failure>
        <span className="ml-auto">
          <DeleteButton
            question={label.rules > 0 ? `Remove ${label.name} and its ${plural(label.rules, 'rule')}?` : `Remove ${label.name}?`}
            says="The mail you said was this stops being shown to the model as examples."
            onDelete={async () => {
              await remove.settle(() => api.removeLabel(label.id));
              toast(label.name, { kind: 'Label removed' });
              onSaved();
              onClose();
            }}
          >
            Remove
          </DeleteButton>
        </span>
      </>
    );

  return (
    <Panel narrow open onClose={onClose} actions={actions} title={label.name} position={position} onPrevious={onPrevious} onNext={onNext}>
      <div className="flex flex-col gap-8">
        <Figures>
          {/* The count is of all time; Activity reaches back 90 days at most. */}
          <Figure
            label="Messages"
            value={count(label.messages)}
            note={`${percent(label.messages, mail)} of the mail`}
            {...(label.messages > 0 ? { href: `/activity?show=all&days=90&label=${encodeURIComponent(label.id)}` } : {})}
          />
          <Figure
            label="Right"
            value={label.record.reviewed === 0 ? '–' : percent(label.record.right, label.record.reviewed)}
            note={label.record.reviewed === 0 ? 'not checked yet' : `of ${plural(label.record.reviewed, 'answer')}`}
            tone={weak(label) ? 'look' : undefined}
          />
          <Figure label="Rules" value={count(label.rules)} {...(label.rules > 0 ? { href: `/rules?label=${label.id}` } : {})} />
        </Figures>
        {/* Mild's own: nothing about it changes. */}
        {label.gmailLabel === null ? (
          <p className="text-muted-foreground">
            Mail none of your labels fit stays in your inbox. Add a label of your own for mail you want treated differently.
          </p>
        ) : (
          <Form onSubmit={() => ready && save()}>
            <LabelFields draft={draft} onChange={setDraft} gmailLabel={label.gmailLabel} />
          </Form>
        )}
      </div>
    </Panel>
  );
}
