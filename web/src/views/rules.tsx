import { useState } from 'react';
import { DispositionBadge, ErrorNote, Outcome, Sub } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count } from '@/lib/format.ts';
import { Button, Code, Empty, Input, Loading, Select, Sheet, SheetHead, Table, Td, Th, Tr } from '@/system';

const CONDITIONS: Record<string, string> = { from: 'from', fromDomain: 'from domain', to: 'to', listId: 'list', subjectContains: 'subject contains' };
const SOURCES: Record<string, string> = { user: 'You', agent: 'sift', correction: 'You, correcting sift' };

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
  ['fromDomain', 'From domain'],
  ['from', 'From address'],
  ['listId', 'Mailing list id'],
  ['to', 'Sent to'],
  ['subjectContains', 'Subject contains'],
] as const;
const THEN = [
  ['archive', 'Archive'],
  ['keep', 'Keep in inbox'],
  ['spam', 'Mark spam'],
] as const;

function AddRule({ accountId, onAdded }: { accountId: string; onAdded: () => void }) {
  const { busy, error, run } = useAction();
  const [when, setWhen] = useState<(typeof WHEN)[number][0]>('fromDomain');
  const [value, setValue] = useState('');
  const [then, setThen] = useState<(typeof THEN)[number][0]>('archive');
  return (
    <>
      <form
        className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => api.addRule({ accountId, match: { [when]: value.trim() }, disposition: then }),
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
          placeholder={when === 'fromDomain' ? 'example.com' : ''}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Select label="What sift does" value={then} options={THEN} onChange={setThen} />
        <Button variant="ink" type="submit" size="sm" busy={busy} disabled={value.trim() === ''}>
          Add rule
        </Button>
      </form>
      <Outcome error={error} />
    </>
  );
}

export function Rules() {
  const { data, error, loading, reload } = useLoaded('rules', (signal) => api.rules(signal));
  const accounts = useLoaded('rule-accounts', (signal) => api.manage(signal), 300_000);
  const remove = useAction();
  const accountId = accounts.data?.accounts[0]?.id;
  const multipleAccounts = new Set(data?.rules.map((r) => r.accountId)).size > 1;
  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote message={error} /> : null}
      <Sheet>
        <SheetHead title="Rules" description="Checked in order, before anything else. A matching keep rule always wins." />
        {accountId ? <AddRule accountId={accountId} onAdded={reload} /> : null}
        <Outcome error={remove.error} />
        {loading ? (
          <Loading />
        ) : !data || data.rules.length === 0 ? (
          <Empty>No rules yet.</Empty>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>When mail is</Th>
                <Th>sift does</Th>
                <Th>Added by</Th>
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
                  <Td className="whitespace-nowrap">
                    <DispositionBadge disposition={rule.disposition} />
                    {rule.label ? <Sub mono>{rule.label}</Sub> : null}
                  </Td>
                  <Td quiet>{SOURCES[rule.source] ?? rule.source}</Td>
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
