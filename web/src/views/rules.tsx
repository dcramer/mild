import { useState } from 'react';
import { DispositionBadge, ErrorNote, Outcome, Sub } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count } from '@/lib/format.ts';
import { Button, Code, Empty, Input, Loading, Select, Sheet, SheetHead, Table, Td, Th, Tr } from '@/system';

const CONDITIONS: Record<string, string> = { from: 'from', fromDomain: 'from domain', to: 'to', listId: 'list', subjectContains: 'subject contains' };
const SOURCES: Record<string, string> = { user: 'You', agent: 'sift learned it', correction: 'You, correcting sift' };

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
  ['', 'Do what the label does'],
  ['keep', 'But keep in inbox'],
  ['archive', 'But archive'],
  ['spam', 'But mark spam'],
] as const;

function AddRule({ accountId, labels, onAdded }: { accountId: string; labels: readonly (readonly [string, string])[]; onAdded: () => void }) {
  const { busy, error, run } = useAction();
  const [when, setWhen] = useState<(typeof WHEN)[number][0]>('from');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [exception, setException] = useState<(typeof EXCEPTION)[number][0]>('');
  return (
    <>
      <form
        className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => api.addRule({ accountId, match: { [when]: value.trim() }, label, ...(exception === '' ? {} : { disposition: exception }) }),
            () => {
              setValue('');
              onAdded();
            },
          );
        }}
      >
        <Select label="Condition" value={when} options={WHEN} onChange={setWhen} />
        <Input
          className="w-64"
          aria-label="Value to match"
          placeholder={when === 'fromDomain' ? 'example.com' : when === 'from' ? 'name@example.com' : ''}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <span className="text-[13px] text-muted-foreground">is</span>
        <Select label="Label" value={label} options={[['', 'Choose a label'] as const, ...labels]} onChange={setLabel} />
        <Select label="Exception to the label's action" value={exception} options={EXCEPTION} onChange={setException} />
        <Button variant="ink" type="submit" size="sm" busy={busy} disabled={value.trim() === '' || label === ''}>
          Add rule
        </Button>
      </form>
      <Outcome error={error} />
    </>
  );
}

/** Everything sift knows without asking a model: the user's rules and the ones it learned. */
export function Rules() {
  const { data, error, loading, reload } = useLoaded('rules', (signal) => api.rules(signal));
  const manage = useLoaded('rule-accounts', (signal) => api.manage(signal), 60_000);
  const remove = useAction();
  const accountId = manage.data?.accounts[0]?.id;
  const labels = accountId ? (manage.data?.labels[accountId] ?? []).map((l) => [l.id, l.name] as const) : [];
  const multipleAccounts = new Set(data?.rules.map((r) => r.accountId)).size > 1;
  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote message={error} /> : null}
      <Sheet>
        <SheetHead
          title="Rules"
          description="A rule says what mail is; its label decides what happens. Checked in order, before any model, and one that keeps mail always wins."
        />
        {accountId ? <AddRule accountId={accountId} labels={labels} onAdded={reload} /> : null}
        <Outcome error={remove.error} />
        {loading ? (
          <Loading />
        ) : !data || data.rules.length === 0 ? (
          <Empty>No rules yet. Answering a suggestion makes one for that sender.</Empty>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>When mail is</Th>
                <Th>It is</Th>
                <Th>sift does</Th>
                <Th>From</Th>
                <Th num>Matches</Th>
                <Th>Last matched</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {data.rules.map((rule) => (
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
                    {rule.disposition ? <DispositionBadge disposition={rule.disposition} /> : <span className="text-muted-foreground">Nothing</span>}
                    {rule.override ? <Sub>exception to the label</Sub> : null}
                  </Td>
                  <Td quiet className="whitespace-nowrap">
                    {SOURCES[rule.source] ?? rule.source}
                  </Td>
                  <Td num>{count(rule.hits)}</Td>
                  <Td quiet className="whitespace-nowrap">
                    {rule.lastHitAt ? ago(rule.lastHitAt) : 'Never'}
                  </Td>
                  <Td className="py-1.5 text-right">
                    <Button variant="quiet" size="sm" disabled={remove.busy} onClick={() => remove.run(() => api.removeRule(rule.id), reload)}>
                      Remove
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Sheet>
    </div>
  );
}
