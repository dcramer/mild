import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type LabelSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import { ACTIONS, type ActionKey, EXPLAIN, count, percent } from '@/lib/format.ts';
import {
  Button,
  Check,
  Code,
  Dialog,
  Empty,
  Failure,
  Field,
  Form,
  Input,
  ListView,
  Look,
  Loading,
  OnPhone,
  Select,
  Share,
  Sub,
  Table,
  Td,
  TextArea,
  Th,
  Tr,
  TrGroup,
} from '@/system';

const canMarkRead = (does: string) => does === 'keep' || does === 'archive';

interface Draft {
  name: string;
  description: string;
  disposition: ActionKey;
  markRead: boolean;
  unsubscribe: boolean;
}

/** Add a label, or change one. `label` is the one being changed. */
function LabelDialog({ accountId, label, onClose, onSaved }: { accountId: string; label: LabelSummary | null; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [draft, setDraft] = useState<Draft>({
    name: label?.name ?? '',
    description: label?.description ?? '',
    disposition: (label?.disposition as ActionKey) ?? 'keep',
    markRead: label?.markRead ?? false,
    unsubscribe: label?.unsubscribe ?? false,
  });
  const ready = draft.name.trim() !== '';
  const save = () =>
    run(
      () =>
        label
          ? api.saveLabel(accountId, label.id, { ...draft, name: draft.name.trim(), description: draft.description.trim() })
          : api.addLabel({ accountId, ...draft, name: draft.name.trim(), description: draft.description.trim() }),
      () => {
        onSaved();
        onClose();
      },
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title={label ? label.name : 'Add a label'}
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={save}>
            {label ? 'Save' : 'Add label'}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => ready && save()}>
        <Field
          label="Name"
          {...(label
            ? {
                hint: (
                  <>
                    In Gmail it stays <Code>{label.gmailLabel}</Code>, so mail already labelled keeps its label.
                  </>
                ),
              }
            : {})}
        >
          <Input
            autoFocus
            aria-label="Name"
            className="w-full"
            maxLength={60}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>
        <Field label="How to recognise it" hint="The model reads this to decide. Say what belongs and what does not.">
          <TextArea
            aria-label="How to recognise it"
            className="min-h-28"
            maxLength={600}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>
        <Field label="Then" hint={EXPLAIN[draft.disposition]}>
          <Select label="What sift does with it" value={draft.disposition} options={ACTIONS} onChange={(disposition) => setDraft({ ...draft, disposition })} />
        </Field>
        <Field
          label="Also"
          hint={
            draft.unsubscribe
              ? `Only while sift is acting, never from someone you have written to, and it cannot be undone from here.${
                  draft.disposition === 'spam' || draft.disposition === 'block'
                    ? ' Answering a spammer’s link tells them the address is read, so sift only does it when the message proves who sent it.'
                    : ''
                }`
              : undefined
          }
        >
          <div className="flex flex-col gap-2">
            {canMarkRead(draft.disposition) ? (
              <Check checked={draft.markRead} onChange={(markRead) => setDraft({ ...draft, markRead })}>
                Mark it read
              </Check>
            ) : null}
            <Check checked={draft.unsubscribe} onChange={(unsubscribe) => setDraft({ ...draft, unsubscribe })}>
              Unsubscribe, when the sender offers a safe way
            </Check>
          </div>
        </Field>
      </Form>
    </Dialog>
  );
}

/** What happens to the mail, as the groups the list is in. Blocking is spam that also turns the sender away. */
const GROUPS = [
  ['keep', 'Stay in the inbox'],
  ['archive', 'Archived'],
  ['spam', 'Spam'],
] as const;
const groupOf = (disposition: string) => (disposition === 'block' ? 'spam' : disposition);

/** Wrong often enough to look at: under 85% right, over at least ten answers. */
const weak = (label: LabelSummary) => label.record.reviewed >= 10 && label.record.right / label.record.reviewed < 0.85;

/** How often sift had the label right when the reader checked, in yellow when it is often wrong. */
function Right({ label }: { label: LabelSummary }) {
  if (label.record.reviewed === 0) return <span className="text-muted-foreground">Not checked</span>;
  const text = `${percent(label.record.right, label.record.reviewed)} right`;
  return weak(label) ? <Look>{text}</Look> : <span className="text-muted-foreground">{text}</span>;
}

/** The labels: what mail can be, grouped by what happens to it, with how much of the mail each is and how often sift has it right. */
export function LabelsView() {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  const [editing, setEditing] = useState<{ accountId: string; label: LabelSummary | null } | null>(null);
  const accounts = data?.accounts ?? [];
  const all = accounts.flatMap((account) => (data?.labels[account.id] ?? []).map((label) => ({ account, label })));
  const mail = all.reduce((sum, { label }) => sum + label.messages, 0);
  const first = accounts[0];

  return (
    <ListView
      title="Labels"
      actions={
        <Button disabled={!first} onClick={() => first && setEditing({ accountId: first.id, label: null })}>
          <PlusIcon aria-hidden />
          Add a label
        </Button>
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
              <Th phone="hide">Share of mail</Th>
              <Th phone="hide">Messages</Th>
              <Th phone="hide">Right</Th>
            </Tr>
          </thead>
          {GROUPS.map(([key, title]) => {
            const group = all.filter(({ label }) => groupOf(label.disposition) === key);
            return group.length === 0 ? null : (
              <tbody key={key}>
                <TrGroup title={title} span={4} />
                {group.map(({ account, label }) => (
                  <Tr key={`${account.id}/${label.id}`} onOpen={() => setEditing({ accountId: account.id, label })}>
                    <Td className="max-w-0 md:w-[28%]">
                      <span className="name">{label.name}</span>
                      {label.disposition === 'block' ? <span className="text-muted-foreground"> · blocks the sender</span> : null}
                      {accounts.length > 1 ? <Sub>{account.email}</Sub> : null}
                      <OnPhone>
                        <Right label={label} />
                      </OnPhone>
                    </Td>
                    <Td phone="hide" className="align-middle md:w-full">
                      <Share part={label.messages} whole={mail} />
                    </Td>
                    <Td phone="hide" num quiet className="md:w-36" title={`${percent(label.messages, mail)} of the mail`}>
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
            );
          })}
        </Table>
      )}
      {editing ? <LabelDialog accountId={editing.accountId} label={editing.label} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </ListView>
  );
}
