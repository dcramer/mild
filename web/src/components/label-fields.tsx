'use client';
import { type ReactNode, useState } from 'react';
import { type LabelProposal, api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/components/action.ts';
import { type Suggestion, SuggestionList, keepWord, keptLabels, suggestionOf } from '@/components/label-suggestions.tsx';
import { DescribeStep } from '@/components/describe.tsx';
import { ACTIONS, type ActionKey, EXPLAIN } from '@/lib/words.ts';
import { ActionIcon, Button, Check, Code, Dialog, Failure, Field, Form, Input, Note, Select, TextArea } from '@/system';
import { reveal } from '@/lib/reveal.ts';

const canMarkRead = (does: string) => does === 'keep' || does === 'archive' || does === 'digest';
const ICONS = Object.fromEntries(ACTIONS.map(([key]) => [key, <ActionIcon key={key} action={key} />])) as Record<ActionKey, ReactNode>;

export interface LabelDraft {
  name: string;
  description: string;
  disposition: ActionKey;
  markRead: boolean;
  unsubscribe: boolean;
}

/** What a label is and what happens to it: the fields for adding one and for changing one. */
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
      <Field inline label="Then" hint={EXPLAIN[draft.disposition]}>
        <Select
          label="What Mild does with it"
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
            ? `Only while Mild is on, never from someone you have written to, and it cannot be undone from here.${
                draft.disposition === 'spam' || draft.disposition === 'block'
                  ? ' Answering a spammer’s link tells them the address is read, so Mild only does it when the message proves who sent it.'
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

type Stage = { at: 'describe' } | { at: 'suggested'; proposal: LabelProposal } | { at: 'edit'; proposal: LabelProposal; index: number } | { at: 'manual' };

const BLANK: LabelDraft = { name: '', description: '', disposition: 'archive', markRead: false, unsubscribe: false };

/**
 * Add labels, the person's for every mailbox: describe the mail and what should happen to it, and keep what fits of
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
          <p className="text-muted-foreground">“{reveal(stage.proposal.goal)}”</p>
          {stage.proposal.note ? (
            <Note tone="look" title="Not in these labels">
              {reveal(stage.proposal.note)}
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
      hint="Mild suggests one label or several, mostly for mail to move, none overlapping the ones you have. You choose which to add."
      placeholder="Archive shipping updates, but never a missed or failed delivery"
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
