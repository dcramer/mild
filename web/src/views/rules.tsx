import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { ago, count, describeMatch, outcomeName } from '@/lib/format.ts';
import {
  Does,
  Button,
  Check,
  ConfirmButton,
  Dialog,
  Empty,
  Failure,
  Field,
  FilterGroup,
  Form,
  Input,
  ListView,
  Loading,
  OnPhone,
  RowActions,
  Select,
  Sub,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@/system';

const SOURCES = [
  ['', 'Anyone'],
  ['user', 'You'],
  ['correction', 'You, correcting sift'],
  ['agent', 'sift, by blocking'],
] as const;

const WHEN = [
  ['from', 'From the address'],
  ['fromDomain', 'From anyone at'],
  ['listId', 'On the list'],
  ['to', 'Sent to'],
  ['subjectContains', 'Subject contains'],
] as const;
const KINDS = [
  ['action', 'Always do this to it'],
  ['label', 'It is always this label'],
  ['when-label', 'When sift says it is this label'],
] as const;
type Kind = (typeof KINDS)[number][0];
const DOES = [
  ['keep', 'Keep it'],
  ['archive', 'Archive it'],
  ['spam', 'Spam it'],
] as const;
const AS_LABEL = ['', 'As the label says'] as const;
type Does = '' | (typeof DOES)[number][0];
const READING: Record<Kind, string> = {
  action: 'No model reads this mail, and sift does not say what it is.',
  label: 'No model reads this mail.',
  'when-label': 'sift still reads each message. Mail from here that is something else is judged as usual.',
};

function AddRuleDialog({
  accountId,
  labels,
  from,
  onClose,
  onAdded,
}: {
  accountId: string;
  labels: readonly (readonly [string, string])[];
  /** A sender to start from, when the dialog was opened from one of their messages. */
  from?: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { busy, error, run } = useAction();
  const [when, setWhen] = useState<(typeof WHEN)[number][0]>('from');
  const [value, setValue] = useState(from ?? '');
  const [kind, setKind] = useState<Kind>('action');
  const [label, setLabel] = useState('');
  const [does, setDoes] = useState<Does>('archive');
  const [markRead, setMarkRead] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState(false);
  const [condition, setCondition] = useState('');
  // An action rule has no label to take its action from.
  const action = kind === 'action' && does === '' ? 'archive' : does;
  const ready = value.trim() !== '' && (kind === 'action' || label !== '');
  const add = () =>
    run(
      () =>
        api.addRule({
          accountId,
          match: { [when]: value.trim() },
          ...(kind === 'label' ? { label } : kind === 'when-label' ? { whenLabel: label } : {}),
          ...(action === '' ? {} : { disposition: action }),
          ...(markRead ? { markRead } : {}),
          ...(unsubscribe ? { unsubscribe } : {}),
          ...(kind === 'label' && condition.trim() !== '' ? { when: condition.trim() } : {}),
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
        <Field label="Mail">
          <Select label="Condition" value={when} options={WHEN} onChange={setWhen} />
          <Input
            autoFocus
            className="min-w-48 flex-1"
            aria-label="Value to match"
            placeholder={when === 'fromDomain' ? 'example.com' : when === 'from' ? 'name@example.com' : ''}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Field label="Then" hint={READING[kind]}>
          <Select label="What the rule says" value={kind} options={KINDS} onChange={setKind} />
          {kind === 'action' ? null : <Select label="Label" value={label} options={[['', 'Choose a label'] as const, ...labels]} onChange={setLabel} />}
          <Select label="What sift does" value={action} options={kind === 'action' ? DOES : [AS_LABEL, ...DOES]} onChange={setDoes} />
        </Field>
        {kind === 'label' ? (
          <Field label="Only when it is (optional)" hint="In your words. Only a model can apply this, so sift reads each message the rule matches.">
            <Input
              aria-label="What the mail must be, in your words"
              className="w-full"
              placeholder="a notice for a lot I did not bid on"
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Also">
          <div className="flex flex-col gap-2">
            <Check checked={markRead} onChange={setMarkRead}>
              Mark it read
            </Check>
            <Check checked={unsubscribe} onChange={setUnsubscribe}>
              Unsubscribe, when the sender offers a safe way
            </Check>
          </div>
        </Field>
      </Form>
    </Dialog>
  );
}

/** Everything sift knows without asking a model: the user's rules and the ones it learned. */
export function Rules() {
  const { data, error, loading, reload } = useLoaded('rules', (signal) => api.rules(signal));
  const manage = useLoaded('rule-accounts', (signal) => api.manage(signal), 60_000);
  const remove = useAction();
  const toast = useToast();
  const [search, setSearch] = useParam('q');
  const [label, setLabel] = useParam('label');
  const [source, setSource] = useParam('by', SOURCES);
  const [adding, setAdding] = useState(false);
  // Opened from a message ("Make a rule…"): the dialog starts on its sender.
  const [from, setFrom] = useParam('from');
  const accountId = manage.data?.accounts[0]?.id;
  const labels = accountId ? (manage.data?.labels[accountId] ?? []).map((l) => [l.id, l.name] as const) : [];
  const multipleAccounts = new Set(data?.rules.map((r) => r.accountId)).size > 1;
  const needle = search.trim().toLowerCase();
  const rules = (data?.rules ?? []).filter(
    (r) =>
      (label === '' || r.labelId === label) &&
      (source === '' || r.source === source) &&
      (needle === '' || [...Object.values(r.match), r.labelName ?? ''].some((text) => text.toLowerCase().includes(needle))),
  );

  return (
    <ListView
      title="Rules"
      actions={
        // Shown from the start and enabled once the account is known, so it does not arrive late and move the page.
        <Button disabled={!accountId} onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden />
          Add a rule
        </Button>
      }
      search={{ value: search, onChange: setSearch, placeholder: 'Search senders, domains and labels' }}
      filters={{
        active: [
          ...(label === '' ? [] : [{ label: `Label: ${labels.find(([id]) => id === label)?.[1] ?? label}`, clear: () => setLabel('') }]),
          ...(source === '' ? [] : [{ label: `Made by: ${SOURCES.find(([key]) => key === source)?.[1]}`, clear: () => setSource('') }]),
        ],
        panel: (
          <>
            <FilterGroup label="Label" value={label} options={[['', 'Any'] as const, ...labels]} onChange={setLabel} />
            <FilterGroup label="Made by" value={source} options={SOURCES} onChange={setSource} />
          </>
        ),
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      <Failure>{remove.error}</Failure>
      {loading ? (
        <Loading />
      ) : rules.length === 0 ? (
        <Empty>
          {data && data.rules.length > 0
            ? 'No rule matches.'
            : 'No rules yet. A rule says what mail is without asking a model; answering a suggestion makes one.'}
        </Empty>
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>Mail</Th>
              <Th phone="hide">Is</Th>
              <Th phone="hide">Then</Th>
              <Th phone="hide">Made by</Th>
              <Th phone="hide" num>
                Used
              </Th>
              <Th />
            </Tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const then = rule.disposition ? (
                <Does action={rule.disposition}>{outcomeName(rule.disposition)}</Does>
              ) : (
                <span className="text-muted-foreground">Nothing</span>
              );
              const is = rule.labelGone
                ? 'A removed label'
                : rule.kind === 'action'
                  ? 'Anything'
                  : rule.kind === 'when-label'
                    ? `When it is ${rule.labelName}`
                    : (rule.labelName ?? '');
              return (
                <Tr key={rule.id}>
                  <Td className="max-w-0 md:w-[40%]">
                    <span className="block break-words">{describeMatch(rule.match)}</span>
                    {rule.except.map((except, index) => (
                      <Sub key={index}>unless {describeMatch(except)}</Sub>
                    ))}
                    {rule.when ? <Sub className="whitespace-normal">when it is {rule.when}</Sub> : null}
                    {multipleAccounts ? <Sub>{rule.accountId}</Sub> : null}
                    <OnPhone>
                      <span className="font-medium text-foreground">{is}</span>
                      {then}
                    </OnPhone>
                  </Td>
                  <Td phone="hide" className="whitespace-nowrap">
                    {rule.labelGone ? (
                      <Failure inline>A removed label</Failure>
                    ) : rule.kind === 'action' ? (
                      <span className="text-muted-foreground">Anything</span>
                    ) : (
                      <span className="font-medium">{is}</span>
                    )}
                    {rule.kind === 'when-label' || rule.when ? <Sub>sift reads each one</Sub> : null}
                  </Td>
                  <Td phone="hide" className="whitespace-nowrap">
                    {then}
                    {rule.override && rule.kind === 'label' ? <Sub>instead of the label’s</Sub> : null}
                  </Td>
                  <Td phone="hide" quiet className="whitespace-nowrap">
                    {SOURCES.find(([key]) => key === rule.source)?.[1] ?? rule.source}
                  </Td>
                  <Td phone="hide" num quiet={rule.hits === 0}>
                    {rule.hits === 0 ? 'Never' : count(rule.hits)}
                    {rule.lastHitAt ? <Sub>{ago(rule.lastHitAt)}</Sub> : null}
                  </Td>
                  <RowActions phone="keep">
                    <ConfirmButton
                      question="Remove this rule?"
                      disabled={remove.busy}
                      onConfirm={() =>
                        remove.run(
                          () => api.removeRule(rule.id),
                          () => {
                            toast(`Removed the rule for mail ${describeMatch(rule.match)}.`);
                            reload();
                          },
                        )
                      }
                    >
                      Remove
                    </ConfirmButton>
                  </RowActions>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {(adding || from !== '') && accountId ? (
        <AddRuleDialog
          accountId={accountId}
          labels={labels}
          {...(from === '' ? {} : { from })}
          onClose={() => {
            setAdding(false);
            setFrom('');
          }}
          onAdded={reload}
        />
      ) : null}
    </ListView>
  );
}
