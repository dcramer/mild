import { useState } from 'react';
import { ErrorNote, Outcome } from '@/components/bits.tsx';
import { type LabelSummary, type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { ACTIONS, type ActionKey, count, percent } from '@/lib/format.ts';
import { Button, Code, Input, Loading, Select, Sheet, SheetHead, TextArea } from '@/system';

/** The fields of a label the user writes: what it is called and how to recognise it. */
function LabelForm({
  start,
  submit,
  busy,
  onSubmit,
  onCancel,
}: {
  start: { name: string; description: string; disposition: ActionKey };
  submit: string;
  busy: boolean;
  onSubmit: (label: { name: string; description: string; disposition: ActionKey }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [disposition, setDisposition] = useState(start.disposition);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name: name.trim(), description: description.trim(), disposition });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-64" aria-label="Name" placeholder="Name" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        <Select label="What sift does with it" value={disposition} options={ACTIONS} onChange={setDisposition} />
      </div>
      <TextArea
        aria-label="How to recognise it"
        placeholder="How to recognise it. The model reads this, so say what belongs and what does not."
        className="min-h-20 font-sans"
        maxLength={600}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button variant="ink" size="sm" type="submit" busy={busy} disabled={name.trim() === ''}>
          {submit}
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** One label: what it is, what happens to its mail, and how much rests on it. */
function LabelRow({ accountId, label, reload }: { accountId: string; label: LabelSummary; reload: () => void }) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const facts = [
    `${count(label.messages)} ${label.messages === 1 ? 'message' : 'messages'}`,
    label.record.reviewed > 0 ? `right on ${percent(label.record.right, label.record.reviewed)} of ${count(label.record.reviewed)} you checked` : null,
  ].filter(Boolean);

  if (editing) {
    return (
      <li className="row px-4 py-4">
        <LabelForm
          start={{ name: label.name, description: label.description, disposition: label.disposition as ActionKey }}
          submit="Save"
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(change) =>
            run(
              () => api.saveLabel(accountId, label.id, change),
              () => {
                setEditing(false);
                reload();
              },
            )
          }
        />
        {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      </li>
    );
  }
  return (
    <li className="row grid gap-x-8 gap-y-2 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="name">{label.name}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{label.description}</p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
          <Code>{label.gmailLabel}</Code>
          {label.rules > 0 ? (
            <a className="underline-offset-2 hover:text-foreground hover:underline" href="#rules">
              {count(label.rules)} {label.rules === 1 ? 'rule' : 'rules'}
            </a>
          ) : null}
          <span>{facts.join(' · ')}</span>
        </p>
        {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
      </div>
      <div className="flex items-start gap-1.5">
        <Select
          label={`What sift does with ${label.name}`}
          value={label.disposition as ActionKey}
          options={ACTIONS}
          disabled={busy}
          onChange={(disposition) => run(() => api.saveLabel(accountId, label.id, { disposition }), reload)}
        />
        <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    </li>
  );
}

function AccountLabels({
  account,
  labels,
  title,
  reload,
}: {
  account: ManageState['accounts'][number];
  labels: LabelSummary[];
  title: string;
  reload: () => void;
}) {
  const { busy, error, run } = useAction();
  const [adding, setAdding] = useState(false);
  return (
    <Sheet>
      <SheetHead
        title={title}
        description="Every message gets one label, from a rule or from a model. The label decides what happens to it, and is added to it in Gmail."
        action={
          adding ? null : (
            <Button size="sm" onClick={() => setAdding(true)}>
              Add a label
            </Button>
          )
        }
      />
      {adding ? (
        <div className="px-4 pt-1 pb-4">
          <LabelForm
            start={{ name: '', description: '', disposition: 'review' }}
            submit="Add label"
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={(label) =>
              run(
                () => api.addLabel({ accountId: account.id, ...label }),
                () => {
                  setAdding(false);
                  reload();
                },
              )
            }
          />
        </div>
      ) : null}
      <Outcome error={error} />
      <ul>
        {labels.map((label) => (
          <LabelRow key={label.id} accountId={account.id} label={label} reload={reload} />
        ))}
      </ul>
    </Sheet>
  );
}

/** The labels: what mail can be, and what sift does with each. */
export function LabelsView() {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Sheet>
          <Loading rows={6} />
        </Sheet>
      ) : (
        data?.accounts.map((account) => (
          <AccountLabels
            key={account.id}
            account={account}
            labels={data.labels[account.id] ?? []}
            title={data.accounts.length > 1 ? `Labels · ${account.email}` : 'Labels'}
            reload={reload}
          />
        ))
      )}
    </div>
  );
}
