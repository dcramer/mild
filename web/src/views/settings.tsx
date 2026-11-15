import { type ReactNode, useEffect, useState } from 'react';
import { ErrorNote, Outcome } from '@/components/bits.tsx';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count } from '@/lib/format.ts';
import { Button, Code, Loading, Note, Select, Sheet, SheetHead, SubNav, TextArea } from '@/system';

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
const PAGES = [
  { to: 'settings/running', label: 'Running' },
  { to: 'settings/accounts', label: 'Accounts' },
  { to: 'settings/guidelines', label: 'Guidelines' },
  { to: 'settings/older', label: 'Older mail' },
] as const;

/** One thing the reader can set: what it is, what follows from it, and the control. */
function Setting({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="row flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium">{title}</p>
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
    <>
      {activity.problems.length > 0 ? (
        <Note tone="failure" title="Not working">
          {activity.problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </Note>
      ) : null}
      {!activity.sorting ? (
        <Note tone="look" title="Not sorting">
          <p>
            Only the dashboard is running. Start <Code>sift run</Code>.
          </p>
        </Note>
      ) : null}
      <Sheet>
        <SheetHead
          title={settings.act ? 'Acting' : 'Observing'}
          description={
            settings.act ? 'sift carries out its decisions in Gmail. Each can be undone under Changes.' : 'sift only suggests. Nothing in Gmail is changed.'
          }
          action={
            settings.act ? (
              <Button size="sm" busy={busy} onClick={() => save({ act: false })}>
                Go back to observing
              </Button>
            ) : confirming ? null : (
              <Button size="sm" onClick={() => setConfirming(true)}>
                Let sift act…
              </Button>
            )
          }
        />
        {confirming && !settings.act ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-1 pb-4">
            <p className="min-w-0 flex-1 basis-72">sift will start archiving, labelling and marking spam on new mail, by itself, as each label says.</p>
            <div className="flex items-center gap-2">
              <Button
                variant="mark"
                busy={busy}
                onClick={() => {
                  setConfirming(false);
                  save({ act: true });
                }}
              >
                Start acting
              </Button>
              <Button variant="quiet" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        <Setting title="Model" note="Sorts mail that no rule or remembered sender covers.">
          <Select
            label="Model"
            value={settings.model ?? ''}
            options={modelOptions}
            disabled={busy}
            onChange={(model) => save({ model: model === '' ? null : model })}
          />
        </Setting>
        <Setting title="Check for mail" note={activity.sorting ? (activity.lastPassAt ? `Last checked ${ago(activity.lastPassAt)}.` : 'Starting.') : undefined}>
          <Select
            label="How often"
            value={interval}
            disabled={busy}
            options={interval === '' ? [['', `Every ${settings.interval} seconds`] as const, ...INTERVALS] : INTERVALS}
            onChange={(value) => value !== '' && save({ interval: Number(value) })}
          />
          {activity.sorting ? (
            <Button size="sm" disabled={busy} onClick={() => run(() => api.checkNow(), reload)}>
              Check now
            </Button>
          ) : null}
        </Setting>
        <Outcome error={error} />
      </Sheet>
    </>
  );
}

function Accounts({ state }: { state: ManageState }) {
  return (
    <Sheet>
      <SheetHead
        title="Accounts"
        description="Anyone signed in as one of these sees all of them."
        action={
          <Button size="sm" href="/auth/login?add=1">
            Connect another
          </Button>
        }
      />
      {state.accounts.map((account) => (
        <div key={account.id} className="row flex flex-wrap items-baseline gap-x-4 px-4 py-3.5">
          <span className="name">{account.email}</span>
          <span className="text-[13px] text-muted-foreground">{account.lastSyncedAt ? `Synced ${ago(account.lastSyncedAt)}` : 'Not synced yet'}</span>
        </div>
      ))}
    </Sheet>
  );
}

function OlderMail() {
  const { busy, error, run } = useAction();
  const [days, setDays] = useState<(typeof DAYS)[number][0]>('7');
  const [result, setResult] = useState<string | null>(null);
  return (
    <Sheet>
      <SheetHead title="Older mail" description="sift only sorts mail that arrives after it starts. Pull in older mail to have more to teach it with." />
      <Setting title="Pull in as suggestions" note="Up to 300 messages, one model call each. They are never acted on, even while sift is acting.">
        <Select label="How far back" value={days} options={DAYS} onChange={setDays} />
        <Button
          variant="ink"
          size="sm"
          busy={busy}
          onClick={() =>
            run(async () => {
              const { added } = await api.backfill(Number(days));
              setResult(
                added === 0 ? 'Nothing new in that period.' : `${count(added)} messages pulled in. They appear under Suggestions as sift decides them.`,
              );
            })
          }
        >
          Pull in
        </Button>
      </Setting>
      <Outcome error={error} done={result} />
    </Sheet>
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
    <Sheet>
      <SheetHead
        title="Guidelines"
        description="In your own words. The model reads this before sorting each message."
        action={
          <Button
            variant="ink"
            size="sm"
            busy={busy}
            disabled={text === stored}
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
      <div className="px-4 pt-1 pb-4">
        <TextArea aria-label="Guidelines" value={text} maxLength={8000} onChange={(event) => setText(event.target.value)} />
      </div>
      <Outcome error={error} />
    </Sheet>
  );
}

/** How sift runs, a page at a time. What it does with mail is under Labels. */
export function SettingsView({ page = 'running' }: { page: string | undefined }) {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  const current = PAGES.some((p) => p.to === `settings/${page}`) ? `settings/${page}` : PAGES[0].to;
  return (
    <SubNav label="Settings" items={PAGES} current={current}>
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Sheet>
          <Loading rows={6} />
        </Sheet>
      ) : data ? (
        current === 'settings/accounts' ? (
          <Accounts state={data} />
        ) : current === 'settings/guidelines' ? (
          <Guidelines saved={data.guidelines} />
        ) : current === 'settings/older' ? (
          <OlderMail />
        ) : (
          <Running state={data} reload={reload} />
        )
      ) : null}
    </SubNav>
  );
}
