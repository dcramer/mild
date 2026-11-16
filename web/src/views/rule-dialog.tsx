import { useState } from 'react';
import { type LabelSummary, api, useAction } from '@/lib/api.ts';
import { outcomeName } from '@/lib/format.ts';
import { Button, Check, Dialog, Failure, Field, Form, Input, Select } from '@/system';

const BY = [
  ['from', 'from'],
  ['listId', 'on the list'],
  ['to', 'sent to'],
  ['subjectContains', 'with a subject containing'],
] as const;
type By = (typeof BY)[number][0];
const ACTIONS = ['archive', 'spam', 'keep'] as const;
type Action = (typeof ACTIONS)[number];

/** "From" takes an address or a domain: with a name before an @ it is one address, otherwise everyone at the domain. */
function fromMatch(text: string): Record<string, string> {
  const value = text.trim();
  return /^[^@\s]+@[^@\s]+$/.test(value) ? { from: value } : { fromDomain: value.replace(/^@/, '') };
}

/**
 * A rule in the order sift applies it: which mail (an address, a domain, a list, a recipient or words in
 * the subject), only when it is something in the reader's words, and the label it is, which brings what
 * that label does. With no label, the rule is an action alone, and says which.
 */
export function AddRuleDialog({
  accountId,
  labels,
  from,
  onClose,
  onAdded,
}: {
  accountId: string;
  labels: LabelSummary[];
  /** A sender to start from, when the dialog was opened from one of their messages. */
  from?: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { busy, error, run } = useAction();
  const [by, setBy] = useState<By>('from');
  const [value, setValue] = useState(from ?? '');
  const [condition, setCondition] = useState('');
  const [label, setLabel] = useState('');
  const [then, setThen] = useState<'' | Action>('');
  const [markRead, setMarkRead] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState(false);
  const chosen = labels.find((l) => l.id === label);
  // A rule with no label is only an action, so it needs one; a condition in words needs a label to describe.
  const action: '' | Action = chosen ? '' : then || 'archive';
  const needsLabel = condition.trim() !== '' && !chosen;
  const match = by === 'from' ? fromMatch(value) : { [by]: value.trim() };
  const ready = value.trim() !== '' && !needsLabel;
  const add = () =>
    run(
      () =>
        api.addRule({
          accountId,
          match,
          ...(chosen ? { label: chosen.id } : {}),
          ...(action ? { disposition: action } : {}),
          ...(!chosen && markRead ? { markRead } : {}),
          ...(!chosen && unsubscribe ? { unsubscribe } : {}),
          ...(chosen && condition.trim() !== '' ? { when: condition.trim() } : {}),
        }),
      () => {
        onAdded();
        onClose();
      },
    );

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a rule"
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={add}>
            Add rule
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => ready && add()}>
        <Field
          inline
          label="Mail"
          hint={by === 'from' && value.trim() !== '' ? ('fromDomain' in match ? `Anyone at ${match['fromDomain']}` : 'Only this address') : undefined}
        >
          <Select label="Match mail" value={by} options={BY} onChange={setBy} />
          <Input
            autoFocus
            className="min-w-40 flex-1"
            aria-label="Value to match"
            placeholder={by === 'from' ? 'an address or a domain' : ''}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Field
          inline
          label="Only when"
          hint={
            needsLabel
              ? 'Choose what it is, below, for this to describe.'
              : condition.trim() !== ''
                ? 'A model reads each message it matches to check.'
                : undefined
          }
        >
          <Input
            className="w-full"
            aria-label="Only when it is, in your words"
            placeholder="optional: it is a notice for a lot I did not bid on"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          />
        </Field>
        <Field inline label="Is">
          <Select
            label="What the mail is"
            value={label}
            options={[['', 'No label'] as const, ...labels.map((l) => [l.id, l.name] as const)]}
            onChange={setLabel}
          />
        </Field>
        {chosen ? null : (
          <>
            <Field inline label="Then">
              <Select label="What happens to it" value={action || 'archive'} options={ACTIONS.map((a) => [a, outcomeName(a)] as const)} onChange={setThen} />
            </Field>
            <Field inline label="Also">
              <div className="flex flex-col gap-2">
                <Check checked={markRead} onChange={setMarkRead}>
                  Mark it read
                </Check>
                <Check checked={unsubscribe} onChange={setUnsubscribe}>
                  Unsubscribe, when the sender offers a safe way
                </Check>
              </div>
            </Field>
          </>
        )}
      </Form>
    </Dialog>
  );
}
