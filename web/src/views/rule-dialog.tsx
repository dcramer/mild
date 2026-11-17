import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { setParams } from '@/lib/route.ts';
import { type LabelSummary, type RuleFilter, type RuleMatch, api, useAction, useLoaded } from '@/lib/api.ts';
import { type By, type RuleStart, replacedBy } from '@/lib/rule-start.ts';
import { FACTS, type FactAnswer, type FactKey, factConditions, factParam, factWords, outcomeName } from '@/lib/format.ts';
import { Button, Check, Dialog, Does, Failure, Field, Form, Input, Select, useToast } from '@/system';
import { useFilterOffer } from '@/views/gmail-filter.tsx';

const BY = [
  ['from', 'from'],
  ['listId', 'on the list'],
  ['to', 'sent to'],
  ['subjectContains', 'with a subject containing'],
] as const satisfies readonly (readonly [By, string])[];
const NAME_MATCH = [
  ['fromName', 'is'],
  ['fromNameContains', 'contains'],
] as const;
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
 * Once added, a rule Gmail could run by itself is offered as a filter, showing the filter.
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
  /** After the rule is added and said. `rule` is what it does, for a caller that acts on the message it was opened from. */
  onAdded?: (match: RuleMatch, rule: { whenLabel?: string; disposition?: Action }) => void;
}) {
  const { busy, error, run } = useAction();
  // Undo is pressed after the dialog has closed, so what it reports goes to a toast.
  const later = useAction();
  const toast = useToast();
  const [by, setBy] = useState<By>(start?.by ?? 'from');
  const [value, setValue] = useState(start?.value ?? '');
  const [nameMatch, setNameMatch] = useState<(typeof NAME_MATCH)[number][0]>('fromName');
  const [name, setName] = useState(start?.name ?? '');
  const [facts, setFacts] = useState<FactAnswer[]>(start?.facts ?? []);
  const [condition, setCondition] = useState('');
  const [label, setLabel] = useState(start?.label ?? '');
  const [whenLabel, setWhenLabel] = useState(start?.whenLabel ?? '');
  const [then, setThen] = useState<'' | Action>(start?.action ?? '');
  const [markRead, setMarkRead] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState(false);
  const [offer, setOffer] = useState<{ id: string; filter: RuleFilter } | null>(null);
  const [applyNow, setApplyNow] = useState(true);
  // Once it is made, the rule opens wherever this was, with what it covers in the inbox; ticked, the look at the inbox too.
  const opened = (id: string | undefined) => {
    onClose();
    if (id) setParams({ rule: id, apply: applyNow && moves ? '1' : '' });
  };
  const filterStep = useFilterOffer(() => opened(offer?.id));
  // A rule that waits for a label takes the label a tier gives, so it names none of its own.
  const waitsFor = labels.find((l) => l.id === whenLabel);
  const chosen = waitsFor ? undefined : labels.find((l) => l.id === label);
  // A rule with no label is only an action, so it needs one; a condition in words needs a label to describe.
  const action: '' | Action = chosen ? '' : then || 'archive';
  const needsLabel = !waitsFor && condition.trim() !== '' && !chosen;
  // An action alone that keeps mail changes nothing in the inbox.
  const moves = chosen !== undefined || waitsFor !== undefined || action !== 'keep';
  // A name is only asked about beside the address or domain it comes from: anyone can send under any name.
  const naming = by === 'from' && name.trim() !== '';
  const nameAlone = naming && value.trim() === '';
  const named = by === 'from' ? { ...fromMatch(value), ...(naming ? { [nameMatch]: name.trim() } : {}) } : value.trim() === '' ? {} : { [by]: value.trim() };
  const match = facts.length > 0 ? { ...named, facts: factConditions(facts) } : named;
  const ready = (value.trim() !== '' || facts.length > 0) && !needsLabel && !nameAlone;
  // Adding a rule with exactly the conditions of one already there replaces it, so the dialog says which.
  const rules = useLoaded('rules', (signal) => api.rules(signal));
  const replaces = ready ? replacedBy(rules.data?.rules ?? [], accountId, match, waitsFor?.id ?? null) : undefined;
  const replacing = replaces ? (replaces.kind === 'label' ? replaces.override : replaces.disposition) : null;
  const unused = (except: FactKey | null) => ANSWERS.filter((a) => a.key === except || !facts.some((f) => f.key === a.key));
  const add = () => {
    let added: { id: string; replaced: boolean; filter: RuleFilter | null } | null = null;
    const takeBack = (id: string) =>
      later.run(
        () =>
          api.removeRule(id).catch((failure: unknown) => {
            toast('Could not take the rule back', { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) });
            throw failure;
          }),
        () => toast('Rule taken back'),
      );
    run(
      async () => {
        added = await api.addRule({
          accountId,
          match,
          ...(chosen ? { label: chosen.id } : {}),
          ...(waitsFor ? { whenLabel: waitsFor.id } : {}),
          ...(action ? { disposition: action } : {}),
          ...(!chosen && markRead ? { markRead } : {}),
          ...(!chosen && unsubscribe ? { unsubscribe } : {}),
          ...(chosen && condition.trim() !== '' ? { when: condition.trim() } : {}),
          ...(proposal === undefined ? {} : { proposal }),
        });
      },
      () => {
        // Removing a rule that replaced another would not bring the other back, so only a new one can be undone.
        const fresh = added?.replaced === false ? added.id : null;
        // The dialog just showed the rule, so the toast need not say it again.
        toast('Rule added', fresh === null ? {} : { undo: () => takeBack(fresh) });
        onAdded?.(match, { ...(waitsFor ? { whenLabel: waitsFor.id } : {}), ...(action ? { disposition: action } : {}) });
        if (added?.filter) setOffer({ id: added.id, filter: added.filter });
        else opened(added?.id);
      },
    );
  };

  if (offer) return <Dialog open onClose={onClose} {...filterStep(offer.id, offer.filter, 'Not now')} />;
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
        {by === 'from' ? (
          <Field inline label="Name" hint={nameAlone ? 'Anyone can send under any name, so give the address or domain too.' : undefined}>
            <Select label="How the name matches" value={nameMatch} options={NAME_MATCH} onChange={setNameMatch} />
            <Input
              className="min-w-40 flex-1"
              aria-label="Sender's name"
              placeholder="any name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        ) : null}
        <Field inline label="That" hint={facts.some((f) => READ.has(f.key)) ? 'Sift reads each message to check this.' : undefined}>
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
        <Field inline label="When it is" hint={waitsFor ? 'A model reads each message it matches to tell.' : undefined}>
          <Select
            label="Only when it is this label"
            value={whenLabel}
            options={[['', 'Any label'] as const, ...labels.map((l) => [l.id, l.name] as const)]}
            onChange={setWhenLabel}
          />
        </Field>
        {waitsFor ? null : (
          <>
            <Field
              inline
              label="Only when"
              hint={
                needsLabel
                  ? 'Choose a label below for this to describe.'
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
            <Field inline label="Label as">
              <Select
                label="Label it as"
                value={label}
                options={[['', 'No label, just act'] as const, ...labels.map((l) => [l.id, l.name] as const)]}
                onChange={setLabel}
              />
            </Field>
          </>
        )}
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
        {moves ? (
          <Field inline label="Inbox" hint="You see what it covers before anything moves.">
            <Check checked={applyNow} onChange={setApplyNow}>
              Apply to mail already there
            </Check>
          </Field>
        ) : null}
      </Form>
    </Dialog>
  );
}
