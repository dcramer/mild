import { useState } from 'react';
import { ErrorNote, Outcome, Sub } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, dateTime } from '@/lib/format.ts';
import { Button, Empty, FilterGroup, ListView, Loading, Table, Td, Th, Tr } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const STATUS = [
  ['', 'Any'],
  ['done', 'Done'],
  ['undone', 'Undone'],
  ['trouble', 'Needs a look'],
] as const;
const WHAT: Record<string, string> = { archive: 'Archived', spam: 'Marked spam', label: 'Labelled', undo: 'Undid', unsubscribe: 'Unsubscribed' };

/** Everything sift has done to the mailbox, each reversible. */
export function ChangesView({ onOpen, epoch }: { onOpen: OpenMessages; epoch: number }) {
  const { data, error, loading, reload } = useLoaded(`changes-${epoch}`, (signal) => api.changes(signal));
  const action = useAction();
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUS)[number][0]>('');
  const troubled = (s: string) => s === 'failed' || s === 'unknown' || s === 'pending';
  const needle = search.trim().toLowerCase();
  const changes = (data?.changes ?? []).filter(
    (c) =>
      (status === '' || (status === 'trouble' ? troubled(c.status) : c.status === status)) &&
      (needle === '' || `${c.subject ?? ''} ${c.fromAddress ?? ''}`.toLowerCase().includes(needle)),
  );
  const items = changes.map((c) => ({ accountId: c.accountId, messageId: c.messageId, subject: c.subject ?? '' }));
  return (
    <ListView
      title="Changes"
      count={data ? String(data.changes.length) : null}
      description="Everything sift did in Gmail. It never deletes mail, so each can be undone."
      search={{ value: search, onChange: setSearch, placeholder: 'Search subject or sender' }}
      filters={{
        active: status === '' ? [] : [{ label: `Result: ${STATUS.find(([key]) => key === status)?.[1].toLowerCase()}`, clear: () => setStatus('') }],
        panel: <FilterGroup label="Result" value={status} options={STATUS} onChange={setStatus} />,
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      <div>
        <Outcome error={action.error} done={note} />
        {loading ? (
          <Loading />
        ) : changes.length === 0 ? (
          <Empty>{data && data.changes.length > 0 ? 'No change matches.' : 'Nothing has been changed in Gmail.'}</Empty>
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
              {changes.map((change, index) => {
                const bad = troubled(change.status);
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
                        onClick={() => onOpen(items, index)}
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
                    <Td className="py-1 text-right">
                      {change.status === 'done' && change.type !== 'undo' && change.type !== 'unsubscribe' ? (
                        <Button
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
      </div>
    </ListView>
  );
}
