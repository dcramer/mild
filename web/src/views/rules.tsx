import { DispositionBadge, Empty, ErrorNote, NUM, Panel, PanelHeader, Sub, TD, TH } from '@/components/bits.tsx';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useState } from 'react';
import { Picker } from '@/components/picker.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count } from '@/lib/format.ts';

const CONDITIONS: Record<string, string> = { from: 'from', fromDomain: 'from domain', to: 'to', listId: 'list', subjectContains: 'subject contains' };
const SOURCES: Record<string, string> = { user: 'You', agent: 'Agent', correction: 'Correction' };

function Conditions({ match }: { match: Record<string, string> }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {Object.entries(match).map(([key, value]) => (
        <span key={key} className="inline-flex max-w-72 items-baseline gap-1.5 rounded-md border bg-muted/50 px-1.5 py-0.5 text-[13px]">
          <span className="text-muted-foreground">{CONDITIONS[key] ?? key}</span>
          <span className="truncate font-mono text-xs">{value}</span>
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
    <form
      className="flex flex-wrap items-center gap-2 border-b px-4 py-3"
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
      <Picker label="Condition" value={when} options={WHEN} onChange={setWhen} />
      <Input
        className="h-7 w-64"
        aria-label="Value to match"
        placeholder={when === 'fromDomain' ? 'example.com' : ''}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Picker label="What sift does" value={then} options={THEN} onChange={setThen} />
      <Button type="submit" size="sm" disabled={busy || value.trim() === ''}>
        Add rule
      </Button>
      {error ? <span className="text-[13px] text-destructive">{error}</span> : null}
    </form>
  );
}

export function Rules() {
  const { data, error, loading, reload } = useLoaded('rules', (signal) => api.rules(signal));
  const accounts = useLoaded('rule-accounts', (signal) => api.manage(signal), 300_000);
  const remove = useAction();
  const accountId = accounts.data?.accounts[0]?.id;
  const multipleAccounts = new Set(data?.rules.map((r) => r.accountId)).size > 1;
  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote message={error} /> : null}
      <Panel>
        <PanelHeader title="Rules" description="Rules decide mail without a model, in this order. A matching keep rule always wins." />
        {accountId ? <AddRule accountId={accountId} onAdded={reload} /> : null}
        {remove.error ? <p className="border-b px-4 py-2 text-[13px] text-destructive">{remove.error}</p> : null}
        {loading ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !data || data.rules.length === 0 ? (
          <Empty>No rules yet. A rule decides matching mail without a model.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>When mail matches</TableHead>
                <TableHead className={TH}>sift does</TableHead>
                <TableHead className={TH}>Added by</TableHead>
                <TableHead className={`${TH} text-right`}>Matches</TableHead>
                <TableHead className={TH}>Last matched</TableHead>
                <TableHead className={TH} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rules.map((rule) => (
                <TableRow key={rule.id} className="align-top">
                  <TableCell className={`${TD} whitespace-normal`}>
                    <Conditions match={rule.match} />
                    {rule.except.map((except, index) => (
                      <span key={index} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        unless <Conditions match={except} />
                      </span>
                    ))}
                    <Sub mono>
                      {rule.id}
                      {multipleAccounts ? ` · ${rule.accountId}` : ''}
                    </Sub>
                  </TableCell>
                  <TableCell className={TD}>
                    <DispositionBadge disposition={rule.disposition} />
                    {rule.label ? <Sub>{rule.label}</Sub> : null}
                  </TableCell>
                  <TableCell className={TD}>{SOURCES[rule.source] ?? rule.source}</TableCell>
                  <TableCell className={`${TD} ${NUM}`}>{count(rule.hits)}</TableCell>
                  <TableCell className={`${TD} text-muted-foreground`}>{rule.lastHitAt ? ago(rule.lastHitAt) : 'Never'}</TableCell>
                  <TableCell className={`${TD} text-right`}>
                    <Button variant="ghost" size="sm" disabled={remove.busy} onClick={() => remove.run(() => api.removeRule(rule.id), reload)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
