import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { type LabelSummary, type RuleMatch, api, useAction, useLoaded } from '@/lib/api.ts';
import { type By, type RuleStart, replacedBy } from '@/lib/rule-start.ts';
import { FACTS, type FactAnswer, type FactKey, factConditions, factParam, factWords, outcomeName } from '@/lib/format.ts';
import { Button, Check, Dialog, Does, Failure, Field, Form, Input, Select } from '@/system';

const BY = [
  ['from', 'from'],
  ['listId', 'on the list'],
  ['to', 'sent to'],
  ['subjectContains', 'with a subject containing'],
] as const satisfies readonly (readonly [By, string])[];
const ACTIONS = ['archive', 'spam', 'keep'] as const;
type Action = (typeof ACTIONS)[number];

/** Every answer a fact can have, as one choice each: `isReply:0` is "is a reply". */
const ANSWERS = (Object.keys(FACTS) as FactKey[]).flatMap((key) => FACTS[key].map((_, index): FactAnswer => ({ key, index })));
/** Only what the whole message shows: sift reads each message to check these. */
const READ = new Set<FactKey>(['hasAttachments', 'trackingPixel']);

/** "From" takes an address or a domain: with a name before an @ it is one address, otherwise everyone at the domain. */
function fromMatch(text: string): Record<string, string> {
  const value = text.trim();
  if (value === '') return {};
  return /^[^@\s]+@[^@\s]+$/.test(value) ? { from: value } : { fromDomain: value.replace(/^@/, '') };
}

/**
 * A rule in the order sift applies it: which mail (an address, a domain, a list, a recipient or words in
 * the subject, and what sift saw in it), only when it is something in the reader's words, and the label it
 * is, which brings what that label does. With no label, the rule is an action alone, and says which.
 */
export function AddRuleDialog({
  accountId,
  labels,
  start,
  proposal,
  onClose,
  onAdded,
}: {
  accountId: string;
  labels: readonly Pick<LabelSummary, 'id' | 'name'>[];
  start?: RuleStart;
  /** Adding the rule accepts this proposal; closing without adding leaves it open. */
  proposal?: number;
  onClose: () => void;
  onAdded: (match: RuleMatch) => void;
}) {
  const { busy, error, run } = useAction();
  const [by, setBy] = useState<By>(start?.by ?? 'from');
  const [value, setValue] = useState(start?.value ?? '');
  const [facts, setFacts] = useState<FactAnswer[]>(start?.facts ?? []);
  const [condition, setCondition] = useState('');
  const [label, setLabel] = useState(start?.label ?? '');
  const [then, setThen] = useState<'' | Action>(start?.action ?? '');
  const [markRead, setMarkRead] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState(false);
  const chosen = labels.find((l) => l.id === label);
  // A rule with no label is only an action, so it needs one; a condition in words needs a label to describe.
  const action: '' | Action = chosen ? '' : then || 'archive';
  const needsLabel = condition.trim() !== '' && !chosen;
  const named = by === 'from' ? fromMatch(value) : value.trim() === '' ? {} : { [by]: value.trim() };
  const match = facts.length > 0 ? { ...named, facts: factConditions(facts) } : named;
  const ready = (value.trim() !== '' || facts.length > 0) && !needsLabel;
  // Adding a rule with exactly the conditions of one already there replaces it, so the dialog says which.
  const rules = useLoaded('rules', (signal) => api.rules(signal));
  const replaces = ready ? replacedBy(rules.data?.rules ?? [], accountId, match) : undefined;
  const replacing = replaces ? (replaces.kind === 'label' ? replaces.override : replaces.disposition) : null;
  const unused = (except: FactKey | null) => ANSWERS.filter((a) => a.key === except || !facts.some((f) => f.key === a.key));
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
          ...(proposal === undefined ? {} : { proposal }),
        }),
      () => {
        onAdded(match);
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
          hint={
            value.trim() === ''
              ? facts.length > 0
                ? 'From anyone'
                : undefined
              : by === 'from'
                ? 'fromDomain' in named
                  ? `Anyone at ${named['fromDomain']}`
                  : 'Only this address'
                : undefined
          }
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
        <Field inline label="That" hint={facts.some((f) => READ.has(f.key)) ? 'sift reads each message to check this.' : undefined}>
          <div className="flex w-full flex-col items-start gap-2">
            {facts.map((fact, at) => (
              <span key={fact.key} className="flex max-w-full items-center gap-1">
                <Select
                  label={`Condition ${at + 1}`}
                  value={factParam(fact)}
                  options={unused(fact.key).map((a) => [factParam(a), factWords(a)] as const)}
                  onChange={(next) => setFacts(facts.map((f, i) => (i === at ? (ANSWERS.find((a) => factParam(a) === next) ?? f) : f)))}
                />
                <Button variant="quiet" size="icon" aria-label={`Remove “${factWords(fact)}”`} onClick={() => setFacts(facts.filter((_, i) => i !== at))}>
                  <XIcon aria-hidden />
                </Button>
              </span>
            ))}
            {facts.length < Object.keys(FACTS).length ? (
              <Button variant="quiet" className="-ml-3" onClick={() => setFacts([...facts, unused(null)[0]])}>
                <PlusIcon aria-hidden />
                Add a condition
              </Button>
            ) : null}
          </div>
        </Field>
        {replaces ? (
          <Field inline label="Replaces">
            <span className="flex min-h-(--control) items-center gap-1">
              {replaces.labelName ? <span>{replaces.labelName}</span> : null}
              {replaces.labelName && replacing ? <span className="text-muted-foreground">·</span> : null}
              {replacing ? <Does action={replacing}>{outcomeName(replacing)}</Does> : null}
            </span>
          </Field>
        ) : null}
        <Field
          inline
          label="Only when"
          hint={
            needsLabel ? 'Choose a label below for this to describe.' : condition.trim() !== '' ? 'A model reads each message it matches to check.' : undefined
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
        <Field inline label="Label as">
          <Select
            label="Label it as"
            value={label}
            options={[['', 'No label, just act'] as const, ...labels.map((l) => [l.id, l.name] as const)]}
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
