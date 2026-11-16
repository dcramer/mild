import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type LabelSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { ACTIONS, type ActionKey, EXPLAIN, count, outcomeName, percent } from '@/lib/format.ts';
import {
  Does,
  Button,
  Check,
  Code,
  Dialog,
  Empty,
  Failure,
  Field,
  FilterGroup,
  Form,
  Input,
  ListView,
  Loading,
  OnPhone,
  Select,
  Sub,
  Table,
  Td,
  TextArea,
  Th,
  Tr,
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

const DOES = [['', 'Anything'] as const, ...ACTIONS];

/** The labels: what mail can be, and what sift does with each. */
export function LabelsView() {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  const [search, setSearch] = useParam('q');
  const [does, setDoes] = useParam('does', DOES);
  const [editing, setEditing] = useState<{ accountId: string; label: LabelSummary | null } | null>(null);
  const accounts = data?.accounts ?? [];
  const needle = search.trim().toLowerCase();
  const all = accounts.flatMap((account) => (data?.labels[account.id] ?? []).map((label) => ({ account, label })));
  const shown = all.filter(
    ({ label }) =>
      (does === '' || label.disposition === does) && (needle === '' || `${label.name} ${label.description} ${label.gmailLabel}`.toLowerCase().includes(needle)),
  );
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
      search={{ value: search, onChange: setSearch, placeholder: 'Search labels' }}
      filters={{
        active: does === '' ? [] : [{ label: `Then: ${outcomeName(does)}`, clear: () => setDoes('') }],
        panel: <FilterGroup label="Then" value={does} options={DOES} onChange={setDoes} />,
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Loading rows={6} />
      ) : shown.length === 0 ? (
        <Empty>{all.length === 0 ? 'No labels yet.' : 'No label matches.'}</Empty>
      ) : (
        <Table>
          <thead>
            <Tr>
              <Th>Label</Th>
              <Th phone="hide">Then</Th>
              <Th phone="hide" num>
                Messages
              </Th>
              <Th phone="hide" num>
                Rules
              </Th>
              <Th phone="hide" num>
                Right
              </Th>
            </Tr>
          </thead>
          <tbody>
            {shown.map(({ account, label }) => (
              <Tr key={`${account.id}/${label.id}`} onOpen={() => setEditing({ accountId: account.id, label })}>
                <Td className="max-w-0 md:w-[55%]">
                  <span className="name">{label.name}</span>
                  <Sub>{accounts.length > 1 ? `${account.email} · ${label.description}` : label.description}</Sub>
                  <OnPhone>
                    <Does action={label.disposition}>{outcomeName(label.disposition)}</Does>
                  </OnPhone>
                </Td>
                <Td phone="hide" className="whitespace-nowrap">
                  <Does action={label.disposition}>{outcomeName(label.disposition)}</Does>
                </Td>
                <Td phone="hide" num quiet={label.messages === 0}>
                  {count(label.messages)}
                </Td>
                <Td phone="hide" num quiet={label.rules === 0}>
                  {count(label.rules)}
                </Td>
                <Td
                  phone="hide"
                  num
                  quiet
                  title={label.record.reviewed > 0 ? `${count(label.record.right)} of ${count(label.record.reviewed)} you checked` : undefined}
                >
                  {label.record.reviewed > 0 ? percent(label.record.right, label.record.reviewed) : '–'}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing ? <LabelDialog accountId={editing.accountId} label={editing.label} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </ListView>
  );
}
