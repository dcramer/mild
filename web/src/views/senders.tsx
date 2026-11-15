import { ErrorNote, Outcome, Sub } from '@/components/bits.tsx';
import { api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count } from '@/lib/format.ts';
import { Button, Empty, Loading, Select, Sheet, SheetHead, Table, Td, Th, Tr } from '@/system';

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
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote message={error} /> : null}
      <Sheet>
        <SheetHead title="Senders" description="Mail from these is decided without a model." />
        <Outcome error={action.error} />
        {loading ? (
          <Loading />
        ) : !data || data.senders.length === 0 ? (
          <Empty>None yet. Answering a suggestion adds one.</Empty>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Sender</Th>
                <Th>sift will</Th>
                <Th>Decided by</Th>
                <Th num>Messages</Th>
                <Th>Changed</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {data.senders.map((sender) => (
                <Tr key={`${sender.accountId}/${sender.address}`}>
                  <Td className="max-w-72 truncate">
                    {sender.address}
                    {sender.label ? <Sub mono>{sender.label}</Sub> : null}
                  </Td>
                  <Td className="py-1.5">
                    <Select
                      label={`What sift does with mail from ${sender.address}`}
                      value={sender.disposition as (typeof DOES)[number][0]}
                      options={DOES}
                      disabled={action.busy}
                      onChange={(disposition) => action.run(() => api.setSender(sender.accountId, sender.address, disposition), reload)}
                    />
                  </Td>
                  <Td quiet>{SOURCE[sender.source] ?? sender.source}</Td>
                  <Td num>{count(sender.messages)}</Td>
                  <Td quiet className="whitespace-nowrap">
                    {ago(sender.updatedAt)}
                  </Td>
                  <Td className="py-1.5 text-right">
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={action.busy}
                      onClick={() => action.run(() => api.forgetSender(sender.accountId, sender.address), reload)}
                    >
                      Forget
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
