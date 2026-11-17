import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type LabelSummary, type ManageState, api, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { AddLabelsDialog, LabelPanel, weak } from '@/views/label-panel.tsx';
import { INBOX, count, percent } from '@/lib/format.ts';
import { Blank, Button, Empty, ListView, Look, Loading, Section, Share, Sub, Table, Td, Th, Tr } from '@/system';

/** A label as the person sees it: one thing across their mailboxes, its figures added up, and where it is missing. */
interface Label {
  label: LabelSummary;
  /** The mailboxes that have it, when that is not all of them. */
  only: string[] | null;
}

/** The labels of every mailbox, one per label: a label is made and changed in all of them at once. */
function labelsOf(data: ManageState): Label[] {
  const byId = new Map<string, { label: LabelSummary; in: string[] }>();
  for (const account of data.accounts)
    for (const label of data.labels[account.id] ?? []) {
      const seen = byId.get(label.id);
      if (!seen) byId.set(label.id, { label, in: [account.email] });
      else {
        seen.in.push(account.email);
        seen.label = {
          ...seen.label,
          messages: seen.label.messages + label.messages,
          rules: seen.label.rules + label.rules,
          record: { reviewed: seen.label.record.reviewed + label.record.reviewed, right: seen.label.record.right + label.record.right },
        };
      }
    }
  return [...byId.values()].map(({ label, in: having }) => ({ label, only: having.length < data.accounts.length ? having : null }));
}

/** What Sift does with a label's mail, as the page groups it: blocking is marking spam, and more. */
const GROUPS = [
  { title: 'Kept in your inbox', has: (l: LabelSummary) => l.disposition === 'keep' },
  { title: 'Archived', has: (l: LabelSummary) => l.disposition === 'archive' },
  { title: 'Marked spam', has: (l: LabelSummary) => l.disposition === 'spam' || l.disposition === 'block' },
] as const;

/** Leave in inbox first, where every list has it; then by name, so a label stays put while it is edited. */
const order = (a: Label, b: Label) => Number(b.label.id === INBOX) - Number(a.label.id === INBOX) || a.label.name.localeCompare(b.label.name);

/** Under a label's name: what it is. Leave in inbox has no words of the person's. */
const about = (label: LabelSummary) => (label.id === INBOX ? 'Mail none of your labels fit' : label.description);

/** How often Sift had the label right when the reader checked, in yellow when it is often wrong. Nothing until then. */
function Right({ label }: { label: LabelSummary }) {
  if (label.record.reviewed === 0) return null;
  const text = `${percent(label.record.right, label.record.reviewed)} right`;
  return weak(label) ? <Look>{text}</Look> : <span className="text-muted-foreground">{text}</span>;
}

/**
 * The labels, under what Sift does with their mail, so the page reads as what happens to it: each with what
 * it is, how much of the mail it is and how often Sift has had it right.
 */
export function LabelsView() {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useParam('label');
  const all = data ? labelsOf(data) : [];
  const mail = all.reduce((sum, { label }) => sum + label.messages, 0);
  const groups = GROUPS.map((group) => ({ ...group, rows: all.filter((l) => group.has(l.label)).toSorted(order) })).filter((g) => g.rows.length > 0);
  // Previous and next go down the page as it reads.
  const listed = groups.flatMap((g) => g.rows);
  const at = listed.findIndex(({ label }) => label.id === open);
  // Leave in inbox is not one of the labels the limit counts.
  const own = all.filter(({ label }) => label.id !== INBOX).length;
  const most = data ? Math.max(0, ...data.accounts.map((a) => (data.labels[a.id] ?? []).filter((l) => l.id !== INBOX).length)) : 0;
  const full = !!data && most >= data.labelLimit;

  return (
    <ListView
      title="Labels"
      actions={
        <>
          <span className="text-sm text-muted-foreground tabular-nums max-sm:hidden">{data ? `${count(own)} of ${data.labelLimit}` : <Blank word />}</span>
          <Button
            disabled={!data || data.accounts.length === 0 || full}
            {...(full ? { why: `Sift keeps at most ${data?.labelLimit} labels. Remove one you no longer use first.` } : {})}
            onClick={() => setAdding(true)}
          >
            <PlusIcon aria-hidden />
            Add labels
          </Button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Loading>
          <Td className="max-w-0">
            <span className="name">
              <Blank />
            </span>
            <Sub>
              <Blank />
            </Sub>
          </Td>
          <Td phone="hide" className="w-48">
            <Blank />
          </Td>
          <Td phone="hide" num className="w-28">
            <Blank word />
          </Td>
        </Loading>
      ) : all.length === 0 ? (
        <Empty>No labels yet.</Empty>
      ) : (
        <div className="flex flex-col gap-10 md:gap-12">
          {groups.map((group) => {
            const share = group.rows.reduce((sum, { label }) => sum + label.messages, 0);
            return (
              <Section key={group.title} title={group.title} meta={mail > 0 ? `${percent(share, mail)} of the mail` : undefined}>
                <Table>
                  <thead className="sr-only">
                    <Tr>
                      <Th>Label</Th>
                      <Th phone="hide">Messages</Th>
                      <Th phone="hide">Right</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {group.rows.map(({ label, only }) => (
                      <Tr key={label.id} onOpen={() => setOpen(label.id)}>
                        <Td className="max-w-0">
                          <span className="name">{label.name}</span>
                          {label.id === INBOX ? <span className="text-muted-foreground"> (Default)</span> : null}
                          {/* On a phone what the label is matters more than the room: two lines, not one. */}
                          <Sub className="max-md:line-clamp-2 max-md:whitespace-normal">{about(label)}</Sub>
                          {only ? <Sub>Only in {only.join(', ')}</Sub> : null}
                        </Td>
                        <Td phone="hide" num className="w-48" title={`${percent(label.messages, mail)} of the mail`}>
                          <span className="flex items-center justify-end gap-3">
                            <span className="w-24">
                              <Share part={label.messages} whole={mail} />
                            </span>
                            <span className="w-12 tabular-nums">{count(label.messages)}</span>
                          </span>
                        </Td>
                        <Td
                          phone="hide"
                          num
                          className="w-28"
                          title={label.record.reviewed > 0 ? `${count(label.record.right)} of ${count(label.record.reviewed)} you checked` : undefined}
                        >
                          <Right label={label} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Section>
            );
          })}
        </div>
      )}
      {at !== -1 ? (
        <LabelPanel
          key={listed[at].label.id}
          label={listed[at].label}
          mail={mail}
          position={`${at + 1} of ${listed.length}`}
          onPrevious={at > 0 ? () => setOpen(listed[at - 1].label.id) : undefined}
          onNext={at < listed.length - 1 ? () => setOpen(listed[at + 1].label.id) : undefined}
          onClose={() => setOpen('')}
          onSaved={reload}
        />
      ) : null}
      {adding ? <AddLabelsDialog onClose={() => setAdding(false)} onSaved={reload} /> : null}
    </ListView>
  );
}
