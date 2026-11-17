import { type ReactNode, useState } from 'react';
import { type LabelProposal, type LabelSummary, api, useAction } from '@/lib/api.ts';
import { type Suggestion, SuggestionList, keepWord, keptLabels, suggestionOf } from '@/components/label-suggestions.tsx';
import { DescribeStep } from '@/components/describe.tsx';
import { ACTIONS, type ActionKey, EXPLAIN, count, percent, plural } from '@/lib/format.ts';
import { ActionIcon, Button, Check, Code, Dialog, Failure, Field, Figure, Figures, Form, Input, Note, Panel, Select, TextArea } from '@/system';

const canMarkRead = (does: string) => does === 'keep' || does === 'archive';
/** Wrong often enough to look at: under 85% right, over at least ten answers. */
export const weak = (label: LabelSummary) => label.record.reviewed >= 10 && label.record.right / label.record.reviewed < 0.85;
const ICONS = Object.fromEntries(ACTIONS.map(([key]) => [key, <ActionIcon action={key} />])) as Record<ActionKey, ReactNode>;

export interface LabelDraft {
  name: string;
  description: string;
  disposition: ActionKey;
  markRead: boolean;
  unsubscribe: boolean;
}

/**
 * What a label is and what happens to it: the fields for adding one and for changing one. Everything Else,
 * the only label with no Gmail label (`gmailLabel` null), always keeps, so its action is not offered.
 */
export function LabelFields({ draft, onChange, gmailLabel }: { draft: LabelDraft; onChange: (draft: LabelDraft) => void; gmailLabel?: string | null }) {
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
      {gmailLabel === null ? (
        <Field inline label="Then" hint="Mail that is none of your labels stays in the inbox. To move some of it, add a label for it.">
          Keep
        </Field>
      ) : (
        <>
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
      )}
    </>
  );
}

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

type Stage = { at: 'describe' } | { at: 'suggested'; proposal: LabelProposal } | { at: 'edit'; proposal: LabelProposal; index: number } | { at: 'manual' };

const BLANK: LabelDraft = { name: '', description: '', disposition: 'keep', markRead: false, unsubscribe: false };

/**
 * Add labels, made in every mailbox: describe the mail and what should happen to it, and keep what fits of
 * the one label or several the model suggests (it is shown the labels there are, so it does not repeat
 * them); or write one by hand. Changing a label is in its panel.
 */
export function AddLabelsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [stage, setStage] = useState<Stage>({ at: 'describe' });
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState<LabelDraft>(BLANK);
  const { busy, error, run } = useAction();
  const done = () => {
    onSaved();
    onClose();
  };
  const suggest = () =>
    run(async () => {
      const proposal = await api.proposeLabels(text.trim());
      setSuggestions(proposal.drafts.map(suggestionOf));
      setStage({ at: 'suggested', proposal });
    });
  const kept = keptLabels(suggestions);
  const change = (index: number, next: Partial<Suggestion>) => setSuggestions((all) => all.map((s, i) => (i === index ? { ...s, ...next } : s)));

  if (stage.at === 'manual') {
    const ready = draft.name.trim() !== '';
    const add = () => ready && run(() => api.addLabels([{ ...draft, name: draft.name.trim(), description: draft.description.trim() }]), done);
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
            <Button variant="quiet" onClick={() => setStage({ at: 'describe' })}>
              Describe it instead
            </Button>
            <Failure>{error}</Failure>
          </>
        }
      >
        <Form onSubmit={add}>
          <LabelFields draft={draft} onChange={setDraft} />
        </Form>
      </Dialog>
    );
  }

  if (stage.at === 'edit') {
    const editing = suggestions[stage.index];
    const back = () => setStage({ at: 'suggested', proposal: stage.proposal });
    return (
      <Dialog
        open
        onClose={onClose}
        title={editing.name || 'Add labels'}
        footer={
          <Button variant="ink" disabled={editing.name.trim() === ''} onClick={back}>
            Done
          </Button>
        }
      >
        <Form onSubmit={back}>
          <LabelFields draft={editing} onChange={(next) => change(stage.index, next)} />
        </Form>
      </Dialog>
    );
  }

  if (stage.at === 'suggested')
    return (
      <Dialog
        open
        onClose={onClose}
        title="Add labels"
        footer={
          <>
            {suggestions.length > 0 ? (
              <Button variant="ink" busy={busy} disabled={kept.length === 0} onClick={() => run(() => api.addLabels(kept), done)}>
                {keepWord('Add', kept.length)}
              </Button>
            ) : null}
            <Button variant="quiet" onClick={() => setStage({ at: 'describe' })}>
              Back
            </Button>
            <Failure>{error}</Failure>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground">“{stage.proposal.goal}”</p>
          {stage.proposal.note ? (
            <Note tone="look" title="Not in these labels">
              {stage.proposal.note}
            </Note>
          ) : null}
          {suggestions.length > 0 ? (
            <SuggestionList suggestions={suggestions} onChange={change} onEdit={(index) => setStage({ at: 'edit', proposal: stage.proposal, index })} />
          ) : null}
        </div>
      </Dialog>
    );

  return (
    <DescribeStep
      title="Add labels"
      question="What mail, and what should happen to it?"
      hint="Sift suggests one label or several, none overlapping the ones you have. You choose which to add."
      placeholder="Keep my travel bookings where I see them, but not the deals"
      value={text}
      onChange={setText}
      go="Suggest labels"
      onGo={suggest}
      manual="Write one yourself"
      onManual={() => setStage({ at: 'manual' })}
      busy={busy}
      error={error}
      onClose={onClose}
    />
  );
}
