import { useEffect, useState } from 'react';
import { ErrorNote, Panel, PanelHeader, Sub, TD, TH } from '@/components/bits.tsx';
import { Picker } from '@/components/picker.tsx';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count } from '@/lib/format.ts';

const INTERVALS = [
  ['30', 'Every 30 seconds'],
  ['60', 'Every minute'],
  ['300', 'Every 5 minutes'],
  ['900', 'Every 15 minutes'],
] as const;
const DAYS = [
  ['1', 'The last day'],
  ['3', 'The last 3 days'],
  ['7', 'The last week'],
  ['14', 'The last 2 weeks'],
  ['30', 'The last month'],
] as const;
const DOES = [
  ['keep', 'Keep in inbox'],
  ['archive', 'Archive'],
  ['review', 'Leave for me'],
  ['spam', 'Mark spam'],
] as const;

function Row({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="row flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <div className="font-medium">{title}</div>
        {note ? <p className="text-[13px] text-muted-foreground">{note}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Running({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const models = useLoaded('models', (signal) => api.models(signal), 300_000);
  const [confirming, setConfirming] = useState(false);
  const { settings, activity } = state;
  const save = (change: Parameters<typeof api.saveSettings>[0]) => run(() => api.saveSettings(change), reload);
  const interval = INTERVALS.some(([value]) => Number(value) === settings.interval) ? String(settings.interval) : '';
  const modelOptions = [
    ['', 'No model'] as const,
    ...[...new Set([...(settings.model ? [settings.model] : []), ...(models.data?.models ?? [])])].map((m) => [m, m] as const),
  ];

  return (
    <Panel>
      <PanelHeader
        title="How sift runs"
        description={
          !activity.sorting
            ? 'Only the dashboard is running; nothing is sorting mail. Start `sift run`.'
            : activity.lastPassAt
              ? `Last checked ${ago(activity.lastPassAt)}`
              : 'Starting'
        }
        action={
          activity.sorting ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => api.checkNow(), reload)}>
              Check now
            </Button>
          ) : null
        }
      />
      {activity.problems.map((problem) => (
        <p key={problem} className="row px-4 py-2 text-[13px] text-destructive">
          {problem}
        </p>
      ))}
      <Row
        title={settings.act ? 'Acting' : 'Observing'}
        note={settings.act ? 'Decisions are carried out in Gmail. Each can be undone under Changes.' : 'Nothing in Gmail is changed.'}
      >
        {settings.act ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => save({ act: false })}>
            Go back to observing
          </Button>
        ) : confirming ? (
          <>
            <span className="text-[13px] text-muted-foreground">sift will start archiving and labelling new mail.</span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                save({ act: true });
              }}
            >
              Start acting
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
            Let sift act…
          </Button>
        )}
      </Row>
      <Row title="Model" note="For mail no rule or sender covers.">
        <Picker label="Model" value={settings.model ?? ''} options={modelOptions} onChange={(model) => save({ model: model === '' ? null : model })} />
      </Row>
      <Row title="How often to check for mail">
        <Picker
          label="Interval"
          value={interval}
          options={interval === '' ? [['', `Every ${settings.interval} seconds`] as const, ...INTERVALS] : INTERVALS}
          onChange={(value) => value !== '' && save({ interval: Number(value) })}
        />
      </Row>
      {error ? <p className="px-4 py-2 text-[13px] text-destructive">{error}</p> : null}
    </Panel>
  );
}

function Accounts({ state }: { state: ManageState }) {
  return (
    <Panel>
      <PanelHeader
        title="Accounts"
        action={
          <Button variant="outline" size="sm" render={<a href="/auth/login?add=1" />}>
            Connect another
          </Button>
        }
      />
      {state.accounts.map((account) => (
        <div key={account.id} className="row px-4 py-3">
          {account.email}
        </div>
      ))}
    </Panel>
  );
}

function OlderMail() {
  const { busy, error, run } = useAction();
  const [days, setDays] = useState<(typeof DAYS)[number][0]>('7');
  const [result, setResult] = useState<string | null>(null);
  return (
    <Panel>
      <PanelHeader title="Older mail" />
      <Row title="Pull in as suggestions" note="Up to 300 messages, one model call each. They are never acted on, even while sift is acting.">
        <Picker label="How far back" value={days} options={DAYS} onChange={setDays} />
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { added } = await api.backfill(Number(days));
              setResult(
                added === 0 ? 'Nothing new in that period.' : `${count(added)} messages pulled in. They appear under Suggestions as sift decides them.`,
              );
            })
          }
        >
          {busy ? 'Pulling in…' : 'Pull in'}
        </Button>
      </Row>
      {result ? <p className="px-4 py-2 text-[13px]">{result}</p> : null}
      {error ? <p className="px-4 py-2 text-[13px] text-destructive">{error}</p> : null}
    </Panel>
  );
}

function Guidelines({ saved }: { saved: string }) {
  const { busy, error, run } = useAction();
  const [text, setText] = useState(saved);
  const [stored, setStored] = useState(saved);
  useEffect(() => {
    setText(saved);
    setStored(saved);
  }, [saved]);
  return (
    <Panel>
      <PanelHeader
        title="Guidelines"
        description="The model reads this before sorting each message."
        action={
          <Button
            size="sm"
            disabled={busy || text === stored}
            onClick={() =>
              run(
                () => api.saveGuidelines(text),
                () => setStored(text),
              )
            }
          >
            {text === stored ? 'Saved' : 'Save'}
          </Button>
        }
      />
      <textarea
        aria-label="Guidelines"
        className="block min-h-48 w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed outline-none"
        value={text}
        maxLength={8000}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? <p className="px-4 py-2 text-[13px] text-destructive">{error}</p> : null}
    </Panel>
  );
}

function Categories({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <Panel>
      <PanelHeader title="Kinds of mail" />
      {state.accounts.map((account) => (
        <Table key={account.id}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={TH}>Kind{state.accounts.length > 1 ? ` · ${account.email}` : ''}</TableHead>
              <TableHead className={TH}>sift will</TableHead>
              <TableHead className={TH}>Label</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(state.categories[account.id] ?? []).map((category) => (
              <TableRow key={category.key} className="align-top">
                <TableCell className={`${TD} max-w-xl whitespace-normal`}>
                  <span className="font-medium">{category.name}</span>
                  <Sub>{category.description}</Sub>
                </TableCell>
                <TableCell className={TD}>
                  <div className="flex items-center gap-2">
                    <Picker
                      label={`What sift does with ${category.name}`}
                      value={category.disposition as (typeof DOES)[number][0]}
                      options={DOES}
                      onChange={(disposition) => !busy && run(() => api.setCategory(account.id, category.key, disposition), reload)}
                    />
                  </div>
                </TableCell>
                <TableCell className={`${TD} font-mono text-xs text-muted-foreground`}>{category.label}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ))}
      {error ? <p className="px-4 py-2 text-[13px] text-destructive">{error}</p> : null}
    </Panel>
  );
}

/** Everything about how sift runs and what it does with mail, editable. */
export function SettingsView() {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  if (loading) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote message={error} /> : null}
      {data ? (
        <>
          <Running state={data} reload={reload} />
          <Accounts state={data} />
          <OlderMail />
          <Categories state={data} reload={reload} />
          <Guidelines saved={data.guidelines} />
        </>
      ) : null}
    </div>
  );
}
