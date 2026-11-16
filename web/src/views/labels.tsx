import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type LabelSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { type LabelDraft, LabelFields, LabelPanel, weak } from '@/views/label-panel.tsx';
import { count, outcomeName, percent } from '@/lib/format.ts';
import { Button, Dialog, Does, Empty, Failure, Form, ListView, Look, Loading, OnPhone, Share, Sub, Table, Td, Th, Tr } from '@/system';

/** How often sift had the label right when the reader checked, in yellow when it is often wrong. */
function Right({ label }: { label: LabelSummary }) {
  if (label.record.reviewed === 0) return <span className="text-muted-foreground">Not checked</span>;
  const text = `${percent(label.record.right, label.record.reviewed)} right`;
  return weak(label) ? <Look>{text}</Look> : <span className="text-muted-foreground">{text}</span>;
}

/** Add a label. Changing one is in its panel. */
function AddLabelDialog({ accountId, onClose, onSaved }: { accountId: string; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [draft, setDraft] = useState<LabelDraft>({ name: '', description: '', disposition: 'keep', markRead: false, unsubscribe: false });
  const ready = draft.name.trim() !== '';
  const add = () =>
    run(
      () => api.addLabel({ accountId, ...draft, name: draft.name.trim(), description: draft.description.trim() }),
      () => {
        onSaved();
        onClose();
      },
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a label"
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={add}>
            Add label
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => ready && add()}>
        <LabelFields draft={draft} onChange={setDraft} />
      </Form>
    </Dialog>
  );
}

/** The labels: what mail can be and what happens to it, with how much of the mail each is and how often sift has it right. */
export function LabelsView() {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  const [adding, setAdding] = useState<string | null>(null);
  const [open, setOpen] = useParam('label');
  const accounts = data?.accounts ?? [];
  // Alphabetical, so a label stays where it is when what it does changes.
  const all = accounts
    .flatMap((account) => (data?.labels[account.id] ?? []).map((label) => ({ account, label })))
    .toSorted((a, b) => a.label.name.localeCompare(b.label.name));
  const mail = all.reduce((sum, { label }) => sum + label.messages, 0);
  const first = accounts[0];
  const at = all.findIndex(({ label }) => label.id === open);
  const full = first !== undefined && !!data && (data.labels[first.id]?.length ?? 0) >= data.labelLimit;

  return (
    <ListView
      title="Labels"
      actions={
        <>
          {first && data ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              {count(data.labels[first.id]?.length ?? 0)} of {data.labelLimit}
            </span>
          ) : null}
          <Button
            disabled={!first || full}
            title={full ? `sift keeps at most ${data?.labelLimit} labels. Change one that is no longer used instead.` : undefined}
            onClick={() => first && setAdding(first.id)}
          >
            <PlusIcon aria-hidden />
            Add a label
          </Button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Loading rows={6} />
      ) : all.length === 0 ? (
        <Empty>No labels yet.</Empty>
      ) : (
        <Table>
          <thead className="sr-only">
            <Tr>
              <Th>Label</Th>
              <Th phone="hide">Then</Th>
              <Th phone="hide">Share of mail</Th>
              <Th phone="hide">Messages</Th>
              <Th phone="hide">Right</Th>
            </Tr>
          </thead>
          <tbody>
            {all.map(({ account, label }) => (
              <Tr key={`${account.id}/${label.id}`} onOpen={() => setOpen(label.id)}>
                <Td className="max-w-0 md:w-[24%]">
                  <span className="name">{label.name}</span>
                  {accounts.length > 1 ? <Sub>{account.email}</Sub> : null}
                  <OnPhone>
                    <Does action={label.disposition}>{outcomeName(label.disposition)}</Does>
                    <Right label={label} />
                  </OnPhone>
                </Td>
                <Td phone="hide" className="whitespace-nowrap md:w-32">
                  <Does action={label.disposition}>{outcomeName(label.disposition)}</Does>
                </Td>
                <Td phone="hide" className="align-middle md:w-full">
                  <Share part={label.messages} whole={mail} />
                </Td>
                <Td phone="hide" num quiet className="md:w-32" title={`${percent(label.messages, mail)} of the mail`}>
                  {count(label.messages)}
                </Td>
                <Td
                  phone="hide"
                  num
                  className="md:w-32"
                  title={label.record.reviewed > 0 ? `${count(label.record.right)} of ${count(label.record.reviewed)} you checked` : undefined}
                >
                  <Right label={label} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {at !== -1 ? (
        <LabelPanel
          key={all[at].label.id}
          accountId={all[at].account.id}
          label={all[at].label}
          mail={mail}
          position={`${at + 1} of ${all.length}`}
          onPrevious={at > 0 ? () => setOpen(all[at - 1].label.id) : undefined}
          onNext={at < all.length - 1 ? () => setOpen(all[at + 1].label.id) : undefined}
          onClose={() => setOpen('')}
          onSaved={reload}
        />
      ) : null}
      {adding ? <AddLabelDialog accountId={adding} onClose={() => setAdding(null)} onSaved={reload} /> : null}
    </ListView>
  );
}
