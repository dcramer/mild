import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { ago, count, describeMatch, extras, outcomeName } from '@/lib/format.ts';
import {
  Button,
  Check,
  ConfirmButton,
  Dialog,
  Empty,
  Field,
  FilterGroup,
  Form,
  Input,
  ListView,
  Loading,
  OnPhone,
  RowActions,
  Select,
  Stamp,
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
const EXCEPTION = [
  ['', 'As the label says'],
  ['keep', 'Keep it instead'],
  ['archive', 'Archive it instead'],
  ['spam', 'Spam it instead'],
] as const;

function AddRuleDialog({
  accountId,
  labels,
  onClose,
  onAdded,
}: {
  accountId: string;
  labels: readonly (readonly [string, string])[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { busy, error, run } = useAction();
  const [when, setWhen] = useState<(typeof WHEN)[number][0]>('from');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [exception, setException] = useState<(typeof EXCEPTION)[number][0]>('');
  const [markRead, setMarkRead] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState(false);
  const [tier, setTier] = useState<'always' | 'usually'>('always');
  const [condition, setCondition] = useState('');
  const ready = value.trim() !== '' && label !== '';
  const add = () =>
    run(
      () =>
        api.addRule({
          accountId,
          match: { [when]: value.trim() },
          label,
          ...(exception === '' ? {} : { disposition: exception }),
          ...(markRead ? { markRead } : {}),
          ...(unsubscribe ? { unsubscribe } : {}),
          ...(condition.trim() === '' ? { tier } : { when: condition.trim() }),
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
          {error ? <p className="text-destructive">{error}</p> : null}
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
        <Field label="When it is (optional)" hint="In your words. Only a model can apply this, so sift reads each message the rule matches.">
          <Input
            aria-label="What the mail must be, in your words"
            className="w-full"
            placeholder="a notice for a lot I did not bid on"
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
          />
        </Field>
        <Field label="Is">
          <Select label="Label" value={label} options={[['', 'Choose a label'] as const, ...labels]} onChange={setLabel} />
        </Field>
        {condition.trim() === '' ? (
          <Field label="Reading" hint={tier === 'usually' ? 'sift asks about any that is something else.' : 'The rule decides alone, with no model.'}>
            <Select
              label="Whether sift reads each message"
              value={tier}
              options={[
                ['always', 'sift does not read them'],
                ['usually', 'sift reads each one to check'],
              ]}
              onChange={setTier}
            />
          </Field>
        ) : null}
        <Field label="Then">
          <Select label="What sift does" value={exception} options={EXCEPTION} onChange={setException} />
        </Field>
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
      meta={data ? `${count(data.rules.length)} · the most specific one wins` : null}
      actions={
        accountId ? (
          <Button onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add a rule
          </Button>
        ) : null
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
      {remove.error ? <p className="text-destructive">{remove.error}</p> : null}
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
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Stamp>{outcomeName(rule.disposition)}</Stamp>
                  {extras(rule) ? <span className="text-muted-foreground">+ {extras(rule)}</span> : null}
                </span>
              ) : (
                <span className="text-muted-foreground">Nothing</span>
              );
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
                      <span className="font-medium text-foreground">{rule.labelName ?? 'A removed label'}</span>
                      {then}
                    </OnPhone>
                  </Td>
                  <Td phone="hide" className="whitespace-nowrap">
                    {rule.labelName ? <span className="font-medium">{rule.labelName}</span> : <span className="text-destructive">A removed label</span>}
                    {rule.tier === 'usually' || rule.when ? <Sub>sift reads each one</Sub> : null}
                  </Td>
                  <Td phone="hide" className="whitespace-nowrap">
                    {then}
                    {rule.override ? <Sub>instead of the label’s</Sub> : null}
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
      {adding && accountId ? <AddRuleDialog accountId={accountId} labels={labels} onClose={() => setAdding(false)} onAdded={reload} /> : null}
    </ListView>
  );
}
