import { PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type LabelSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import { ACTIONS, type ActionKey, count, extras, percent } from '@/lib/format.ts';
import { useParam } from '@/lib/route.ts';
import {
  Button,
  Card,
  CardFoot,
  CardGrid,
  CardHead,
  Check,
  Code,
  Dialog,
  Empty,
  FilterGroup,
  Input,
  ListView,
  Loading,
  Select,
  Sheet,
  TextArea,
} from '@/system';

const canMarkRead = (does: string) => does === 'keep' || does === 'archive';
const EXPLAIN: Record<ActionKey, string> = {
  keep: 'It stays in your inbox, with its label.',
  archive: 'It leaves your inbox and stays findable under its label.',
  spam: 'It goes to spam. Refused for anyone you have written to.',
  block: 'It goes to spam, and so does everything that sender sends afterwards, without being judged again. Only when the message proves who sent it.',
};

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
      title={label ? `Edit ${label.name}` : 'Add a label'}
      subtitle={label ? <>In Gmail it stays {label.gmailLabel}, so mail already labelled keeps its label.</> : undefined}
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={draft.name.trim() === ''} onClick={save}>
            {label ? 'Save' : 'Add label'}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.name.trim() !== '') save();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Name</span>
          <Input autoFocus maxLength={60} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">How to recognise it</span>
          <TextArea
            className="min-h-28"
            maxLength={600}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
          <span className="text-sm text-muted-foreground">The model reads this to decide. Say what belongs and what does not.</span>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">What sift does with it</span>
          <div>
            <Select
              label="What sift does with it"
              value={draft.disposition}
              options={ACTIONS}
              onChange={(disposition) => setDraft({ ...draft, disposition })}
            />
          </div>
          <span className="text-sm text-muted-foreground">{EXPLAIN[draft.disposition]}</span>
          {canMarkRead(draft.disposition) ? (
            <Check checked={draft.markRead} onChange={(markRead) => setDraft({ ...draft, markRead })}>
              Also mark it read
            </Check>
          ) : null}
          <Check checked={draft.unsubscribe} onChange={(unsubscribe) => setDraft({ ...draft, unsubscribe })}>
            Also unsubscribe, when the sender offers a safe way
          </Check>
          {draft.unsubscribe ? (
            <span className="text-sm text-muted-foreground">
              Only while sift is acting, never from someone you have written to, and it cannot be undone from here.
              {draft.disposition === 'spam' || draft.disposition === 'block'
                ? ' Answering a spammer’s link tells them the address is read; sift only does it when the message proves who sent it.'
                : ''}
            </span>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

/** One label: what it is, what happens to its mail, and how much rests on it. */
function LabelCard({
  accountId,
  label,
  account,
  onEdit,
  reload,
}: {
  accountId: string;
  label: LabelSummary;
  account: string | null;
  onEdit: () => void;
  reload: () => void;
}) {
  const { busy, error, run } = useAction();
  const facts = [
    `${count(label.messages)} ${label.messages === 1 ? 'message' : 'messages'}`,
    `${count(label.rules)} ${label.rules === 1 ? 'rule' : 'rules'}`,
    extras(label) || null,
    label.record.reviewed > 0 ? `right ${percent(label.record.right, label.record.reviewed)} of ${count(label.record.reviewed)}` : null,
  ].filter(Boolean);
  return (
    <Card>
      <CardHead title={label.name} note={account ?? undefined} aside={<Code>{label.gmailLabel}</Code>} />
      <p className="text-sm text-muted-foreground">{label.description}</p>
      <p className="text-sm text-muted-foreground tabular-nums">{facts.join(' · ')}</p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <CardFoot>
        <Select
          label={`What sift does with ${label.name}`}
          value={label.disposition as ActionKey}
          options={ACTIONS}
          disabled={busy}
          onChange={(disposition) => run(() => api.saveLabel(accountId, label.id, { disposition }), reload)}
        />
        <Button variant="quiet" className="ml-auto" onClick={onEdit}>
          <PencilIcon aria-hidden />
          Edit
        </Button>
      </CardFoot>
    </Card>
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
      count={data ? count(all.length) : null}
      description="Every message gets one label, from a rule or from a model. The label decides what happens to the message, and is added to it in Gmail."
      actions={
        first ? (
          <Button variant="ink" onClick={() => setEditing({ accountId: first.id, label: null })}>
            <PlusIcon aria-hidden />
            Add a label
          </Button>
        ) : null
      }
      search={{ value: search, onChange: setSearch, placeholder: 'Search labels' }}
      filters={{
        active: does === '' ? [] : [{ label: `sift does: ${DOES.find(([key]) => key === does)?.[1].toLowerCase()}`, clear: () => setDoes('') }],
        panel: <FilterGroup label="sift does" value={does} options={DOES} onChange={setDoes} />,
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Sheet>
          <Loading rows={6} />
        </Sheet>
      ) : shown.length === 0 ? (
        <Sheet>
          <Empty>No label matches.</Empty>
        </Sheet>
      ) : (
        <CardGrid>
          {shown.map(({ account, label }) => (
            <LabelCard
              key={`${account.id}/${label.id}`}
              accountId={account.id}
              label={label}
              account={accounts.length > 1 ? account.email : null}
              onEdit={() => setEditing({ accountId: account.id, label })}
              reload={reload}
            />
          ))}
        </CardGrid>
      )}
      {editing ? <LabelDialog accountId={editing.accountId} label={editing.label} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </ListView>
  );
}
