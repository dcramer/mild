import { type ReactNode, useState } from 'react';
import { type LabelSummary, api, useAction } from '@/lib/api.ts';
import { ACTIONS, type ActionKey, EXPLAIN, count, percent, plural } from '@/lib/format.ts';
import { ActionIcon, Button, Check, Code, Dialog, Failure, Field, Figure, Figures, Form, Input, Panel, Select, TextArea } from '@/system';

const canMarkRead = (does: string) => does === 'keep' || does === 'archive';
/** Wrong often enough to look at: under 85% right, over at least ten answers. */
export const weak = (label: LabelSummary) => label.record.reviewed >= 10 && label.record.right / label.record.reviewed < 0.85;
const ICONS = Object.fromEntries(ACTIONS.map(([key]) => [key, <ActionIcon action={key} />])) as Record<ActionKey, ReactNode>;

interface LabelDraft {
  name: string;
  description: string;
  disposition: ActionKey;
  markRead: boolean;
  unsubscribe: boolean;
}

/** What a label is and what happens to it: the fields for adding one and for changing one. */
function LabelFields({ draft, onChange, gmailLabel }: { draft: LabelDraft; onChange: (draft: LabelDraft) => void; gmailLabel?: string }) {
  return (
    <>
      <Field
        inline
        label="Name"
        {...(gmailLabel
          ? {
              hint: (
                <>
                  In Gmail it stays <Code>{gmailLabel}</Code>.
                </>
              ),
            }
          : {})}
      >
        <Input className="w-full" aria-label="Name" maxLength={60} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      </Field>
      <Field inline label="What it is" hint="The model reads this to decide. Say what belongs and what does not.">
        <TextArea
          aria-label="What it is"
          className="min-h-32"
          maxLength={600}
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
      </Field>
      <Field inline label="Then" hint={EXPLAIN[draft.disposition]}>
        <Select
          label="What Sift does with it"
          value={draft.disposition}
          options={ACTIONS}
          icons={ICONS}
          onChange={(disposition) => onChange({ ...draft, disposition })}
        />
      </Field>
      <Field
        inline
        label="Also"
        hint={
          draft.unsubscribe
            ? `Only while Sift is on, never from someone you have written to, and it cannot be undone from here.${
                draft.disposition === 'spam' || draft.disposition === 'block'
                  ? ' Answering a spammer’s link tells them the address is read, so Sift only does it when the message proves who sent it.'
                  : ''
              }`
            : undefined
        }
      >
        <div className="flex flex-col gap-2">
          {canMarkRead(draft.disposition) ? (
            <Check checked={draft.markRead} onChange={(markRead) => onChange({ ...draft, markRead })}>
              Mark it read
            </Check>
          ) : null}
          <Check checked={draft.unsubscribe} onChange={(unsubscribe) => onChange({ ...draft, unsubscribe })}>
            Unsubscribe, when the sender offers a safe way
          </Check>
        </div>
      </Field>
    </>
  );
}

/**
 * One label: how it is doing, then what it is and what happens to it, edited in place. The figures come
 * first because a label is usually opened for one of them: it is often wrong, or takes much of the mail.
 */
export function LabelPanel({
  accountId,
  label,
  mail,
  position,
  onPrevious,
  onNext,
  onClose,
  onSaved,
}: {
  accountId: string;
  label: LabelSummary;
  mail: number;
  position: string;
  onPrevious: (() => void) | undefined;
  onNext: (() => void) | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
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
  const save = () => run(() => api.saveLabel(accountId, label.id, { ...draft, name: draft.name.trim(), description: draft.description.trim() }), onSaved);

  return (
    <Panel narrow open onClose={onClose} title={label.name} position={position} onPrevious={onPrevious} onNext={onNext}>
      <div className="flex flex-col gap-8">
        <Figures>
          <Figure label="Messages" value={count(label.messages)} note={`${percent(label.messages, mail)} of the mail`} />
          <Figure
            label="Right"
            value={label.record.reviewed === 0 ? '–' : percent(label.record.right, label.record.reviewed)}
            note={label.record.reviewed === 0 ? 'not checked yet' : `of ${plural(label.record.reviewed, 'answer')}`}
            tone={weak(label) ? 'look' : undefined}
          />
          <Figure label="Rules" value={count(label.rules)} {...(label.rules > 0 ? { href: `/rules?label=${label.id}` } : {})} />
        </Figures>
        <Form onSubmit={() => ready && save()}>
          <LabelFields draft={draft} onChange={setDraft} gmailLabel={label.gmailLabel} />
          <div className="flex items-center gap-2 sm:pl-28">
            <Button variant="ink" busy={busy} disabled={!ready} onClick={save}>
              Save
            </Button>
            {changed ? (
              <Button variant="quiet" onClick={() => setDraft(initial)}>
                Undo changes
              </Button>
            ) : null}
            <Failure>{error}</Failure>
          </div>
        </Form>
      </div>
    </Panel>
  );
}

/** Add a label. Changing one is in its panel. */
export function AddLabelDialog({ accountId, onClose, onSaved }: { accountId: string; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [draft, setDraft] = useState<LabelDraft>({ name: '', description: '', disposition: 'keep', markRead: false, unsubscribe: false });
  const ready = draft.name.trim() !== '';
  const add = () =>
    run(
      () => api.addLabel({ accountId, ...draft, name: draft.name.trim(), description: draft.description.trim() }),
      () => {
        onSaved();
        onClose();
      },
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a label"
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={add}>
            Add label
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => ready && add()}>
        <LabelFields draft={draft} onChange={setDraft} />
      </Form>
    </Dialog>
  );
}
