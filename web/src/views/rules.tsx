import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { DispositionBadge, ErrorNote, Outcome, Sub } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, extras } from '@/lib/format.ts';
import { Button, Check, Code, Dialog, Empty, FilterGroup, Input, ListView, Loading, Select, Table, Td, Th, Tr } from '@/system';

const CONDITIONS: Record<string, string> = { from: 'from', fromDomain: 'from domain', to: 'to', listId: 'list', subjectContains: 'subject contains' };
const SOURCES = [
  ['', 'Anyone'],
  ['user', 'You'],
  ['correction', 'You, correcting sift'],
  ['agent', 'sift learned it'],
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
const EXCEPTION = [
  ['', 'What the label does'],
  ['keep', 'Keep in inbox instead'],
  ['archive', 'Archive instead'],
  ['spam', 'Mark spam instead'],
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
      subtitle="A rule says what mail is, without asking a model."
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={add}>
            Add rule
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
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
          <span className="text-[13px] font-medium">When mail is</span>
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
          <span className="text-[13px] font-medium">It is</span>
          <div>
            <Select label="Label" value={label} options={[['', 'Choose a label'] as const, ...labels]} onChange={setLabel} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">sift does</span>
          <div>
            <Select label="What sift does" value={exception} options={EXCEPTION} onChange={setException} />
          </div>
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
  const [search, setSearch] = useState('');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<(typeof SOURCES)[number][0]>('');
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
      description="A rule says what mail is; its label decides what happens. Rules are checked before any model. The most specific one wins, and one that keeps mail always does."
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
                    {multipleAccounts ? <Sub>{rule.accountId}</Sub> : null}
                  </Td>
                  <Td className="font-medium whitespace-nowrap">
                    {rule.labelName ?? <span className="font-normal text-destructive">A label that was removed</span>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {rule.disposition ? <DispositionBadge would disposition={rule.disposition} /> : <span className="text-muted-foreground">Nothing</span>}
                    {rule.override ? <Sub>exception to the label</Sub> : null}
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
