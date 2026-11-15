import { Empty, ErrorNote, NUM, Panel, PanelHeader, Sub, TD, TH } from '@/components/bits.tsx';
import { Picker } from '@/components/picker.tsx';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count } from '@/lib/format.ts';

const DOES = [
  ['keep', 'Keep in inbox'],
  ['archive', 'Archive'],
  ['spam', 'Mark spam'],
] as const;
const SOURCE: Record<string, string> = { user: 'You', correction: 'You, correcting sift', agent: 'sift, by itself' };

/** Every sender sift remembers, and what it does with their mail. */
export function SendersView() {
  const { data, error, loading, reload } = useLoaded('senders', (signal) => api.senders(signal));
  const action = useAction();
  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote message={error} /> : null}
      {action.error ? <p className="text-[13px] text-destructive">{action.error}</p> : null}
      <Panel>
        <PanelHeader title="Senders" description="Decided without a model." />
        {loading ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !data || data.senders.length === 0 ? (
          <Empty>None yet. Answering a suggestion adds one.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Sender</TableHead>
                <TableHead className={TH}>sift will</TableHead>
                <TableHead className={TH}>Decided by</TableHead>
                <TableHead className={`${TH} text-right`}>Messages</TableHead>
                <TableHead className={TH}>Changed</TableHead>
                <TableHead className={TH} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.senders.map((sender) => (
                <TableRow key={`${sender.accountId}/${sender.address}`}>
                  <TableCell className={`${TD} max-w-72 truncate`}>
                    {sender.address}
                    {sender.label ? <Sub mono>{sender.label}</Sub> : null}
                  </TableCell>
                  <TableCell className={TD}>
                    <div className="flex items-center gap-2">
                      <Picker
                        label={`What sift does with mail from ${sender.address}`}
                        value={sender.disposition as (typeof DOES)[number][0]}
                        options={DOES}
                        onChange={(disposition) => !action.busy && action.run(() => api.setSender(sender.accountId, sender.address, disposition), reload)}
                      />
                    </div>
                  </TableCell>
                  <TableCell className={`${TD} text-muted-foreground`}>{SOURCE[sender.source] ?? sender.source}</TableCell>
                  <TableCell className={`${TD} ${NUM}`}>{count(sender.messages)}</TableCell>
                  <TableCell className={`${TD} text-muted-foreground`}>{ago(sender.updatedAt)}</TableCell>
                  <TableCell className={`${TD} text-right`}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={action.busy}
                      onClick={() => action.run(() => api.forgetSender(sender.accountId, sender.address), reload)}
                    >
                      Forget
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
