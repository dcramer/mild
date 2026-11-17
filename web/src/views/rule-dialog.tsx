import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { setParams } from '@/lib/route.ts';
import { type LabelSummary, type RuleDraft, type RuleFilter, type RuleMatch, api, useAction, useLoaded } from '@/lib/api.ts';
import { type By, type Condition, type RuleStart, conditionsOf, matchOf, replacedBy, startWords } from '@/lib/rule-start.ts';
import { FACTS, type FactAnswer, type FactKey, describeMatch, factAnswers, factConditions, factParam, factWords, outcomeName } from '@/lib/format.ts';
import { Button, Check, Dialog, Does, Failure, Field, FieldGroup, Form, Input, Note, Select, useToast } from '@/system';
import { useFilterOffer } from '@/views/gmail-filter.tsx';
import { DescribeStep } from '@/components/describe.tsx';

const BY = [
  ['from', 'from'],
  ['fromName', 'named'],
  ['fromNameContains', 'name contains'],
  ['listId', 'on the list'],
  ['to', 'sent to'],
  ['subjectContains', 'subject contains'],
] as const satisfies readonly (readonly [By, string])[];
const PLACEHOLDER: Record<By, string> = {
  from: 'an address or a domain',
  fromName: 'their name',
  fromNameContains: 'words in their name',
  listId: 'a list id',
  to: 'an address',
  subjectContains: 'words in the subject',
};
const ACTIONS = ['archive', 'spam', 'keep'] as const;
type Action = (typeof ACTIONS)[number];

/** Every answer a fact can have, as one choice each: `isReply:0` is "is a reply". */
const ANSWERS = (Object.keys(FACTS) as FactKey[]).flatMap((key) => FACTS[key].map((_, index): FactAnswer => ({ key, index })));
/** Only what the whole message shows: sift reads each message to check these. */
const READ = new Set<FactKey>(['hasAttachments', 'trackingPixel']);

/** One line of the rule's conditions: a value of some kind, or an answer about what Sift saw in the message. */
type Row = Condition | { fact: FactAnswer };
const isNamed = (row: Row): row is Condition => 'by' in row;
const rowsOf = (conditions: readonly Condition[], facts: readonly FactAnswer[]): Row[] =>
  conditions.length + facts.length === 0 ? [{ by: 'from', value: '' }] : [...conditions, ...facts.map((fact) => ({ fact }))];

/**
 * A rule in the order sift applies it: which mail (an address, a domain, a list, a recipient or words in
 * the subject, and what sift saw in it), only when it is something in the reader's words, and the label it
 * is, which brings what that label does. With no label, the rule is an action alone, and says which.
 * Once added, a rule Gmail could run by itself is offered as a filter, showing the filter.
 *
 * It opens on the rule in the reader's words (what it was opened from, said as a sentence):
 * the model fills the form in from them, looking up senders, and the reader checks it and adds it.
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
  const [rows, setRows] = useState<Row[]>(() => rowsOf(start?.conditions ?? [], start?.facts ?? []));
  // A line the reader just added takes the cursor; the ones it opened on do not.
  const [grown, setGrown] = useState(false);
  const [condition, setCondition] = useState('');
  const [label, setLabel] = useState(start?.label ?? '');
  const [whenLabel, setWhenLabel] = useState(start?.whenLabel ?? '');
  const [then, setThen] = useState<'' | Action>(start?.action ?? '');
  const [markRead, setMarkRead] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState(false);
  const [offer, setOffer] = useState<{ id: string; filter: RuleFilter } | null>(null);
  const [applyNow, setApplyNow] = useState(true);
  const drafting = useAction();
  const [describing, setDescribing] = useState(true);
  const [goal, setGoal] = useState(() => (start ? startWords(start, labels) : ''));
  const [note, setNote] = useState<string | null>(null);
  const fill = ({ match: drafted, ...rule }: RuleDraft) => {
    setRows(rowsOf(conditionsOf(drafted), factAnswers(drafted.facts)));
    setGrown(false);
    setLabel(rule.label ?? '');
    setWhenLabel(rule.whenLabel ?? '');
    setCondition(rule.when ?? '');
    setThen(rule.disposition ?? '');
    setMarkRead(rule.markRead ?? false);
    setUnsubscribe(rule.unsubscribe ?? false);
    setNote(rule.note ?? null);
    setDescribing(false);
  };
  const describe = () => goal.trim() !== '' && drafting.run(async () => fill(await api.draftRule(accountId, goal.trim())));
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
  const facts = rows.flatMap((row) => (isNamed(row) ? [] : [row.fact]));
  const named = matchOf(rows.filter(isNamed));
  const match = facts.length > 0 ? { ...named, facts: factConditions(facts) } : named;
  // A name is only asked about beside the address or domain it comes from: anyone can send under any name.
  const nameAlone = (named.fromName !== undefined || named.fromNameContains !== undefined) && named.from === undefined && named.fromDomain === undefined;
  const values = Object.values(named).flat().length;
  const ready = Object.keys(match).length > 0 && !needsLabel && !nameAlone;
  // Read back what is not plain from the lines: who a domain takes in, and that values of a kind are alternatives.
  const readBack =
    values === 0
      ? facts.length > 0
        ? 'From anyone.'
        : undefined
      : values > 1 || named.fromDomain !== undefined
        ? `Mail ${describeMatch(named)}.`
        : named.from !== undefined
          ? 'Only this address.'
          : undefined;
  const hint = nameAlone
    ? 'Anyone can send under any name, so give an address or domain too.'
    : [readBack, facts.some((f) => READ.has(f.key)) ? 'Sift reads each message to check this.' : undefined].filter(Boolean).join(' ') || undefined;
  // Adding a rule with exactly the conditions of one already there replaces it, so the dialog says which.
  const rules = useLoaded('rules', (signal) => api.rules(signal));
  const replaces = ready ? replacedBy(rules.data?.rules ?? [], accountId, match, waitsFor?.id ?? null) : undefined;
  const replacing = replaces ? (replaces.kind === 'label' ? replaces.override : replaces.disposition) : null;
  // What a line can be: any kind of value, or an answer about a fact no other line asks.
  const kinds = (row: Row) => [
    ...BY,
    ...ANSWERS.filter((a) => (!isNamed(row) && a.key === row.fact.key) || !facts.some((f) => f.key === a.key)).map(
      (a) => [factParam(a), factWords(a)] as const,
    ),
  ];
  const retype = (row: Row, next: string): Row => {
    const by = BY.find(([b]) => b === next)?.[0];
    if (by) return { by, value: isNamed(row) ? row.value : '' };
    const fact = ANSWERS.find((a) => factParam(a) === next);
    return fact ? { fact } : row;
  };
  const change = (at: number, row: Row) => setRows(rows.map((r, i) => (i === at ? row : r)));
  const grow = () => {
    // Another line is most often another of the kind before it: a second sender.
    const last = rows.findLast(isNamed);
    setRows([...rows, { by: last?.by ?? 'from', value: '' }]);
    setGrown(true);
  };
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
  if (describing)
    return (
      <DescribeStep
        title="Add a rule"
        question="What should it do?"
        hint="Name a sender as you know them: Sift finds their address in your mail. You see the rule before it is added."
        placeholder="Archive receipts from example.com and mark them read"
        value={goal}
        onChange={setGoal}
        go="Fill in the rule"
        onGo={describe}
        manual="Write it yourself"
        onManual={() => setDescribing(false)}
        busy={drafting.busy}
        error={drafting.error}
        onClose={onClose}
      />
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
          <Button variant="quiet" onClick={() => setDescribing(true)}>
            Describe it instead
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => ready && add()}>
        {note ? (
          <Note tone="look" title="Not in this rule">
            {note}
          </Note>
        ) : null}
        <FieldGroup title="Which mail">
          <Field inline label="Mail" hint={hint}>
            <div className="flex w-full flex-col items-start gap-2">
              {rows.map((row, at) => (
                <span key={at} className="flex w-full min-w-0 items-center gap-1">
                  {/* A kind stays whole beside its value; a long answer about a fact is cut short before the X is. */}
                  <span className={isNamed(row) ? 'shrink-0' : 'flex min-w-0'}>
                    <Select
                      label={`Condition ${at + 1}`}
                      value={isNamed(row) ? row.by : factParam(row.fact)}
                      options={kinds(row)}
                      onChange={(next) => change(at, retype(row, next))}
                    />
                  </span>
                  {isNamed(row) ? (
                    <Input
                      autoFocus={at === rows.length - 1 && (grown || at === 0)}
                      className="min-w-0 flex-1"
                      aria-label={`Value ${at + 1}`}
                      placeholder={PLACEHOLDER[row.by]}
                      value={row.value}
                      onChange={(event) => change(at, { by: row.by, value: event.target.value })}
                    />
                  ) : null}
                  <Button
                    variant="quiet"
                    size="icon"
                    className="ml-auto shrink-0"
                    aria-label={`Remove condition ${at + 1}`}
                    onClick={() => setRows(rows.filter((_, i) => i !== at))}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </span>
              ))}
              <Button variant="quiet" className="-ml-3" onClick={grow}>
                <PlusIcon aria-hidden />
                Add a condition
              </Button>
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
        </FieldGroup>
        <FieldGroup title="What it is">
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
        </FieldGroup>
        <FieldGroup title="What happens">
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
        </FieldGroup>
      </Form>
    </Dialog>
  );
}
