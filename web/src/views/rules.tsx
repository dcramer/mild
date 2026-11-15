import { DispositionBadge, Empty, ErrorNote, NUM, Panel, PanelHeader, Sub, TD, TH } from '@/components/bits.tsx';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, useLoaded } from '@/lib/api.ts';
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

export function Rules() {
  const { data, error, loading } = useLoaded('rules', (signal) => api.rules(signal));
  const multipleAccounts = new Set(data?.rules.map((r) => r.accountId)).size > 1;
  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote message={error} /> : null}
      <Panel>
        <PanelHeader title="Rules" description="Rules decide mail without a model, in this order. A matching keep rule always wins." />
        {loading ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !data || data.rules.length === 0 ? (
          <Empty>
            No rules yet. Add one with <code className="font-mono text-[13px]">sift rules add --do archive --from-domain example.com</code>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>When mail matches</TableHead>
                <TableHead className={TH}>sift does</TableHead>
                <TableHead className={TH}>Added by</TableHead>
                <TableHead className={`${TH} text-right`}>Matches</TableHead>
                <TableHead className={TH}>Last matched</TableHead>
                <TableHead className={TH}>Gmail filter</TableHead>
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
                  <TableCell className={`${TD} text-muted-foreground`}>{rule.filterId ? 'Yes' : 'No'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
