import { type ReactNode, useState } from 'react';
import { type LabelProposal, type LabelSummary, api, useAction } from '@/lib/api.ts';
import { type InboxSuggestion, type Suggestion, SuggestionList, keepWord, keptLabels, suggestionOf } from '@/components/label-suggestions.tsx';
import { DescribeStep } from '@/components/describe.tsx';
import { ACTIONS, type ActionKey, EXPLAIN, INBOX_NAME, count, percent, plural } from '@/lib/format.ts';
import {
  ActionIcon,
  Button,
  Check,
  Code,
  ConfirmButton,
  Dialog,
  Failure,
  Field,
  Figure,
  Figures,
  Form,
  Input,
  Note,
  Panel,
  Select,
  TextArea,
  useToast,
} from '@/system';

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
 * What a label is and what happens to it: the fields for adding one and for changing one. Leave in inbox, the
 * only one with no Gmail label (`gmailLabel` null), has no name or action to change: only what always stays.
 */
export function LabelFields({ draft, onChange, gmailLabel }: { draft: LabelDraft; onChange: (draft: LabelDraft) => void; gmailLabel?: string | null }) {
  if (gmailLabel === null) return <InboxField words={draft.description} onChange={(description) => onChange({ ...draft, description })} />;
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

/** What always stays in the inbox, in the person's words: the model leaves it there whatever label also fits. */
function InboxField({ words, onChange }: { words: string; onChange: (words: string) => void }) {
  return (
    <Field
      inline
      label="Always"
      hint="Sift leaves mail like this in your inbox even when one of your labels also fits it. A rule for its sender still does what the rule says."
    >
      <TextArea
        aria-label="What always stays in your inbox"
        className="min-h-32"
        maxLength={600}
        placeholder="Bills I still have to pay; mail a person wrote to me"
        value={words}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
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
  const save = () =>
    run(
      () =>
        api.saveLabel(
          label.id,
          label.gmailLabel === null ? { description: draft.description.trim() } : { ...draft, name: draft.name.trim(), description: draft.description.trim() },
        ),
      onSaved,
    );

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
        {/* Leave in inbox is what mail is when it is none of the others. */}
        {label.gmailLabel === null ? null : (
          <div>
            <ConfirmButton
              question={label.rules > 0 ? `Remove ${label.name} and its ${plural(label.rules, 'rule')}?` : `Remove ${label.name}?`}
              variant="plain"
              disabled={remove.busy}
              onConfirm={() =>
                remove.run(
                  () => api.removeLabel(label.id),
                  () => {
                    toast(`Label removed: ${label.name}`);
                    onSaved();
                    onClose();
                  },
                )
              }
            >
              Remove
            </ConfirmButton>
            <Failure>{remove.error}</Failure>
          </div>
        )}
      </div>
    </Panel>
  );
}

type Stage =
  | { at: 'describe' }
  | { at: 'suggested'; proposal: LabelProposal }
  | { at: 'edit'; proposal: LabelProposal; index: number | 'inbox' }
  | { at: 'manual' };

const BLANK: LabelDraft = { name: '', description: '', disposition: 'archive', markRead: false, unsubscribe: false };

/**
 * Add labels, made in every mailbox: describe the mail and what should happen to it, and keep what fits of
 * the one label or several the model suggests (it is shown the labels there are, so it does not repeat
 * them); or write one by hand. Changing a label is in its panel.
 */
export function AddLabelsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [stage, setStage] = useState<Stage>({ at: 'describe' });
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [inbox, setInbox] = useState<InboxSuggestion>({ words: '', on: true });
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
      setInbox({ words: proposal.inbox, on: true });
      setStage({ at: 'suggested', proposal });
    });
  const kept = keptLabels(suggestions);
  const adding = inbox.on && inbox.words.trim() !== '';
  const change = (index: number, next: Partial<Suggestion>) => setSuggestions((all) => all.map((s, i) => (i === index ? { ...s, ...next } : s)));
  const keep = () => run(() => api.addLabels(kept, adding ? inbox.words.trim() : undefined), done);

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
    const back = () => setStage({ at: 'suggested', proposal: stage.proposal });
    if (stage.index === 'inbox')
      return (
        <Dialog
          open
          onClose={onClose}
          title={INBOX_NAME}
          footer={
            <Button variant="ink" onClick={back}>
              Done
            </Button>
          }
        >
          <Form onSubmit={back}>
            <InboxField words={inbox.words} onChange={(words) => setInbox((was) => ({ ...was, words }))} />
          </Form>
        </Dialog>
      );
    const index = stage.index;
    const editing = suggestions[index];
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
          <LabelFields draft={editing} onChange={(next) => change(index, next)} />
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
            {suggestions.length > 0 || adding ? (
              <Button variant="ink" busy={busy} disabled={kept.length === 0 && !adding} onClick={keep}>
                {kept.length === 0 && adding ? 'Save' : keepWord('Add', kept.length)}
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
          <SuggestionList
            suggestions={suggestions}
            onChange={change}
            onEdit={(index) => setStage({ at: 'edit', proposal: stage.proposal, index })}
            inbox={{
              ...inbox,
              onChange: (next) => setInbox((was) => ({ ...was, ...next })),
              onEdit: () => setStage({ at: 'edit', proposal: stage.proposal, index: 'inbox' }),
            }}
          />
        </div>
      </Dialog>
    );

  return (
    <DescribeStep
      title="Add labels"
      question="What mail, and what should happen to it?"
      hint="Sift suggests labels for the mail to move, none overlapping yours, and what to leave in your inbox whatever else fits. You choose what to keep."
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
