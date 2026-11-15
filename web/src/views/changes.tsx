import { useState } from 'react';
import { ErrorNote, Outcome, Sub } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, dateTime } from '@/lib/format.ts';
import { Button, Empty, Loading, Sheet, SheetHead, Table, Td, Th, Tr } from '@/system';
import type { MessageRef } from '@/views/message-sheet.tsx';

const WHAT: Record<string, string> = { archive: 'Archived', spam: 'Marked spam', label: 'Labelled', undo: 'Undid' };

/** Everything sift has done to the mailbox, each reversible. */
export function ChangesView({ onOpen }: { onOpen: (message: MessageRef) => void }) {
  const { data, error, loading, reload } = useLoaded('changes', (signal) => api.changes(signal));
  const action = useAction();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote message={error} /> : null}
      <Sheet>
        <SheetHead title="Changes" description="Everything sift did in Gmail. It never deletes mail, so each can be undone." />
        <Outcome error={action.error} done={note} />
        {loading ? (
          <Loading />
        ) : !data || data.changes.length === 0 ? (
          <Empty>Nothing has been changed in Gmail.</Empty>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Change</Th>
                <Th>Message</Th>
                <Th>Result</Th>
                <Th className="text-right">When</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {data.changes.map((change) => {
                const bad = change.status === 'failed' || change.status === 'unknown' || change.status === 'pending';
                return (
                  <Tr key={change.id}>
                    <Td className="whitespace-nowrap">
                      {change.undoOf === null ? (WHAT[change.type] ?? change.type) : `Undid #${change.undoOf}`}
                      <Sub mono>#{change.id}</Sub>
                    </Td>
                    <Td className="max-w-96">
                      <button
                        type="button"
                        className="block max-w-full cursor-pointer truncate text-left font-medium underline-offset-2 hover:underline"
                        onClick={() => onOpen({ accountId: change.accountId, messageId: change.messageId, subject: change.subject ?? '' })}
                      >
                        {change.subject || '(no subject)'}
                      </button>
                      <Sub>{change.fromAddress}</Sub>
                    </Td>
                    <Td className={bad ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                      {change.status}
                      {change.error ? <Sub>{change.error}</Sub> : null}
                    </Td>
                    <Td quiet className="text-right whitespace-nowrap" title={dateTime(change.createdAt)}>
                      {ago(change.createdAt)}
                    </Td>
                    <Td className="py-1.5 text-right">
                      {change.status === 'done' && change.type !== 'undo' ? (
                        <Button
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
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Sheet>
    </div>
  );
}
