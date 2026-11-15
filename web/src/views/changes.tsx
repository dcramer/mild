import { useState } from 'react';
import { Button, Sheet, SheetHead } from '@/system';
import { Empty, ErrorNote, Sub, TD, TH } from '@/components/bits.tsx';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, dateTime } from '@/lib/format.ts';
import type { MessageRef } from '@/views/message-sheet.tsx';

const WHAT: Record<string, string> = { archive: 'Archived', spam: 'Marked spam', label: 'Labelled', undo: 'Undid' };

/** Everything sift has done to the mailbox, each reversible. */
export function ChangesView({ onOpen }: { onOpen: (message: MessageRef) => void }) {
  const { data, error, loading, reload } = useLoaded('changes', (signal) => api.changes(signal));
  const action = useAction();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote message={error} /> : null}
      {action.error ? <p className="text-[13px] text-destructive">{action.error}</p> : null}
      {note ? <p className="text-[13px]">{note}</p> : null}
      <Sheet>
        <SheetHead title="Changes" description="sift never deletes mail." />
        {loading ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !data || data.changes.length === 0 ? (
          <Empty>Nothing has been changed in Gmail.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>When</TableHead>
                <TableHead className={TH}>Change</TableHead>
                <TableHead className={TH}>Message</TableHead>
                <TableHead className={TH}>Result</TableHead>
                <TableHead className={TH} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.changes.map((change) => {
                const bad = change.status === 'failed' || change.status === 'unknown' || change.status === 'pending';
                return (
                  <TableRow key={change.id} className="align-top">
                    <TableCell className={`${TD} whitespace-nowrap text-muted-foreground`} title={dateTime(change.createdAt)}>
                      {ago(change.createdAt)}
                    </TableCell>
                    <TableCell className={`${TD} whitespace-nowrap`}>
                      {change.undoOf === null ? (WHAT[change.type] ?? change.type) : `Undid #${change.undoOf}`}
                      <Sub mono>#{change.id}</Sub>
                    </TableCell>
                    <TableCell className={`${TD} max-w-96`}>
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium underline-offset-2 hover:underline"
                        onClick={() => onOpen({ accountId: change.accountId, messageId: change.messageId, subject: change.subject ?? '' })}
                      >
                        {change.subject || '(no subject)'}
                      </button>
                      <Sub>{change.fromAddress}</Sub>
                    </TableCell>
                    <TableCell className={`${TD} ${bad ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                      {change.status}
                      {change.error ? <Sub>{change.error}</Sub> : null}
                    </TableCell>
                    <TableCell className={`${TD} text-right`}>
                      {change.status === 'done' && change.type !== 'undo' ? (
                        <Button
                          variant="plain"
                          size="sm"
                          disabled={action.busy}
                          onClick={() =>
                            action.run(async () => {
                              const { message } = await api.undo(change.id);
                              setNote(`#${change.id}: ${message}`);
                            }, reload)
                          }
                        >
                          Undo
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Sheet>
    </div>
  );
}
