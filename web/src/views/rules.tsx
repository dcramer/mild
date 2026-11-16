import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { DispositionBadge, ErrorNote, Outcome, Sub } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, extras } from '@/lib/format.ts';
import { useParam } from '@/lib/route.ts';
import { Button, Check, Code, Dialog, Empty, FilterGroup, Input, ListView, Loading, Select, Table, Td, Th, Tr } from '@/system';

const CONDITIONS: Record<string, string> = { from: 'from', fromDomain: 'from domain', to: 'to', listId: 'list', subjectContains: 'subject contains' };
const SOURCES = [
  ['', 'Anyone'],
  ['user', 'You'],
  ['correction', 'You, correcting sift'],
  ['agent', 'sift, by blocking'],
] as const;

function Conditions({ match }: { match: Record<string, string> }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {Object.entries(match).map(([key, value]) => (
        <span key={key} className="inline-flex max-w-72 items-baseline gap-1.5">
          <span className="text-muted-foreground">{CONDITIONS[key] ?? key}</span>
          <span className="truncate">
            <Code>{value}</Code>
          </span>
        </span>
      ))}
    </span>
  );
}

const WHEN = [
  ['from', 'From address'],
  ['fromDomain', 'From domain'],
  ['listId', 'Mailing list id'],
  ['to', 'Sent to'],
  ['subjectContains', 'Subject contains'],
] as const;
const KINDS = [
  ['action', 'Always do this to it'],
  ['label', 'It is always this label'],
  ['when-label', 'When sift says it is this label, do this'],
] as const;
type Kind = (typeof KINDS)[number][0];
const DOES = [
  ['keep', 'Keep in inbox'],
  ['archive', 'Archive'],
  ['spam', 'Mark spam'],
] as const;
const AS_LABEL = ['', 'What the label does'] as const;
type Does = '' | (typeof DOES)[number][0];

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
      subtitle="What happens to mail, what it is, or both."
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={add}>
            Add rule
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) add();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">When mail is</span>
          <div className="flex flex-wrap items-center gap-2">
            <Select label="Condition" value={when} options={WHEN} onChange={setWhen} />
            <Input
              autoFocus
              className="min-w-48 flex-1"
              aria-label="Value to match"
              placeholder={when === 'fromDomain' ? 'example.com' : when === 'from' ? 'name@example.com' : ''}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Then</span>
          <div className="flex flex-wrap items-center gap-2">
            <Select label="What the rule says" value={kind} options={KINDS} onChange={setKind} />
            {kind === 'action' ? null : <Select label="Label" value={label} options={[['', 'Choose a label'] as const, ...labels]} onChange={setLabel} />}
            <Select label="What sift does" value={action} options={kind === 'action' ? DOES : [AS_LABEL, ...DOES]} onChange={setDoes} />
          </div>
          <p className="text-sm text-muted-foreground">
            {kind === 'action'
              ? 'No model reads this mail, and sift does not say what it is.'
              : kind === 'label'
                ? 'No model reads this mail.'
                : 'sift still reads each message. Mail from here that is something else is judged as usual.'}
          </p>
        </div>
        {kind === 'label' ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Only when it is, in your words (optional)</span>
            <Input
              aria-label="What the mail must be, in your words"
              placeholder="a notice for a lot I did not bid on"
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">Only a model can apply this, so sift reads each message the rule matches.</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Check checked={markRead} onChange={setMarkRead}>
            Also mark it read
          </Check>
          <Check checked={unsubscribe} onChange={setUnsubscribe}>
            Also unsubscribe, when the sender offers a safe way
          </Check>
        </div>
      </form>
    </Dialog>
  );
}

/** Everything sift knows without asking a model: the user's rules and the ones it learned. */
export function Rules() {
  const { data, error, loading, reload } = useLoaded('rules', (signal) => api.rules(signal));
  const manage = useLoaded('rule-accounts', (signal) => api.manage(signal), 60_000);
  const remove = useAction();
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
      count={data ? count(data.rules.length) : null}
      description="A rule says what happens to mail, what it is, or both. The most specific one wins, and one that keeps mail always does."
      actions={
        accountId ? (
          <Button variant="ink" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            Add a rule
          </Button>
        ) : null
      }
      search={{ value: search, onChange: setSearch, placeholder: 'Search senders, domains and labels' }}
      filters={{
        active: [
          ...(label === '' ? [] : [{ label: `Label: ${labels.find(([id]) => id === label)?.[1] ?? label}`, clear: () => setLabel('') }]),
          ...(source === '' ? [] : [{ label: `From: ${SOURCES.find(([key]) => key === source)?.[1]}`, clear: () => setSource('') }]),
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
      <div>
        <Outcome error={remove.error} />
        {loading ? (
          <Loading />
        ) : rules.length === 0 ? (
          <Empty>{data && data.rules.length > 0 ? 'No rule matches.' : 'No rules yet. Answering a suggestion makes one.'}</Empty>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>When mail is</Th>
                <Th>It is</Th>
                <Th>sift does</Th>
                <Th>Made by</Th>
                <Th num>Matches</Th>
                <Th>Last matched</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <Tr key={rule.id}>
                  <Td>
                    <Conditions match={rule.match} />
                    {rule.except.map((except, index) => (
                      <span key={index} className="mt-1 flex items-baseline gap-1.5 text-muted-foreground">
                        unless <Conditions match={except} />
                      </span>
                    ))}
                    {rule.when ? <span className="mt-1 block text-muted-foreground">when it is {rule.when}</span> : null}
                    {multipleAccounts ? <Sub>{rule.accountId}</Sub> : null}
                  </Td>
                  <Td className="font-medium whitespace-nowrap">
                    {rule.labelGone ? (
                      <span className="font-normal text-destructive">A label that was removed</span>
                    ) : rule.kind === 'action' ? (
                      <span className="font-normal text-muted-foreground">Anything</span>
                    ) : rule.kind === 'when-label' ? (
                      <>
                        <span className="font-normal text-muted-foreground">when it is </span>
                        {rule.labelName}
                      </>
                    ) : (
                      rule.labelName
                    )}
                    {rule.kind === 'when-label' || rule.when ? <Sub>sift reads each one</Sub> : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {rule.disposition ? <DispositionBadge would disposition={rule.disposition} /> : <span className="text-muted-foreground">Nothing</span>}
                    {rule.override && rule.kind === 'label' ? <Sub>exception to the label</Sub> : null}
                    {extras(rule) ? <Sub>and {extras(rule)}</Sub> : null}
                  </Td>
                  <Td quiet className="whitespace-nowrap">
                    {SOURCES.find(([key]) => key === rule.source)?.[1] ?? rule.source}
                  </Td>
                  <Td num>{count(rule.hits)}</Td>
                  <Td quiet className="whitespace-nowrap">
                    {rule.lastHitAt ? ago(rule.lastHitAt) : 'Never'}
                  </Td>
                  <Td className="py-1 text-right">
                    <Button variant="quiet" disabled={remove.busy} onClick={() => remove.run(() => api.removeRule(rule.id), reload)}>
                      Remove
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      {adding && accountId ? <AddRuleDialog accountId={accountId} labels={labels} onClose={() => setAdding(false)} onAdded={reload} /> : null}
    </ListView>
  );
}
