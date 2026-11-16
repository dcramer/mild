import { useEffect, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { ProviderList, providerName, useProviderConnect } from '@/components/model-connect.tsx';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, money, plural } from '@/lib/format.ts';
import {
  Button,
  Code,
  ConfirmButton,
  Dialog,
  Failure,
  Kbd,
  Loading,
  Note,
  PageHeader,
  Select,
  SettingRow,
  SettingsGroup,
  Sheet,
  TextArea,
  TextLink,
  setShortcutsOn,
  useShortcutsOn,
  useToast,
} from '@/system';

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

/** Whether sift is running and acting, and how often: what the owner comes to Settings for first. */
function Sorting({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const { settings, activity } = state;
  const save = (change: Parameters<typeof api.saveSettings>[0]) => run(() => api.saveSettings(change), reload);
  const interval = INTERVALS.some(([value]) => Number(value) === settings.interval) ? String(settings.interval) : '';

  return (
    <SettingsGroup title="Sorting" note="Whether sift changes Gmail, and how often it looks.">
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
        <SettingRow
          title={settings.act ? 'Acting' : 'Observing'}
          note={
            settings.act ? (
              <>
                sift carries out its decisions in Gmail as each label says. Each change can be undone from <TextLink href="/activity">Activity</TextLink>.
              </>
            ) : (
              'Nothing in Gmail changes. sift suggests, and learns from your answers.'
            )
          }
        >
          {settings.act ? (
            <Button busy={busy} onClick={() => save({ act: false })}>
              Go back to observing
            </Button>
          ) : (
            <ConfirmButton variant="plain" question="Archive, label and mark spam on new mail by itself?" busy={busy} onConfirm={() => save({ act: true })}>
              Start acting
            </ConfirmButton>
          )}
        </SettingRow>
        <SettingRow
          title="Check for mail"
          note={activity.sorting ? (activity.lastPassAt ? `Last checked ${ago(activity.lastPassAt)}.` : 'Starting.') : undefined}
        >
          <Select
            label="How often"
            value={interval}
            disabled={busy}
            options={interval === '' ? [['', `Every ${settings.interval} seconds`] as const, ...INTERVALS] : INTERVALS}
            onChange={(value) => value !== '' && save({ interval: Number(value) })}
          />
          {activity.sorting ? (
            <Button disabled={busy} onClick={() => run(() => api.checkNow(), reload)}>
              Check now
            </Button>
          ) : null}
        </SettingRow>
      </Sheet>
      <Failure>{error}</Failure>
    </SettingsGroup>
  );
}

/** Change the provider: choose, sign in, try a model, switch. Until the switch, the one in use goes on sorting. */
function ChangeProvider({ state, reload, onClose }: { state: ManageState; reload: () => void; onClose: () => void }) {
  const { choices, chosen } = state.model;
  const inUse = chosen?.split('/')[0] ?? null;
  const [picked, setPicked] = useState<(typeof choices)[number] | null>(null);
  const subtitle = inUse
    ? `${providerName(
        choices.find((c) => c.provider === inUse),
        inUse,
      )} keeps sorting until you switch.`
    : undefined;
  if (!picked)
    return (
      <Dialog open onClose={onClose} title="Change provider" {...(subtitle ? { subtitle } : {})}>
        <ProviderList choices={choices} inUse={inUse} onChoose={setPicked} />
      </Dialog>
    );
  return <Switch key={picked.provider} choice={picked} state={state} reload={reload} subtitle={subtitle} onBack={() => setPicked(null)} onClose={onClose} />;
}

function Switch({
  choice,
  state,
  reload,
  subtitle,
  onBack,
  onClose,
}: {
  choice: ManageState['model']['choices'][number];
  state: ManageState;
  reload: () => void;
  subtitle: string | undefined;
  onBack: () => void;
  onClose: () => void;
}) {
  const { fields, ready } = useProviderConnect(choice, state.model, reload);
  const { busy, error, run } = useAction();
  const toast = useToast();
  const old = state.model.chosen?.split('/')[0] ?? null;
  const name = providerName(choice, choice.provider);
  const doSwitch = () =>
    run(async () => {
      if (!ready) return;
      // The new model first, so something always sorts; the old sign-in goes once nothing uses it.
      await api.setModel(ready);
      if (old && old !== choice.provider) await api.signOutModel(old);
      toast(`Now sorting with ${name}.`);
      reload();
      onClose();
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title={name}
      {...(subtitle ? { subtitle } : {})}
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={doSwitch}>
            Switch to {name}
          </Button>
          <Button variant="quiet" onClick={onBack}>
            Back
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      {fields}
    </Dialog>
  );
}

/** The reader's own way to a model and which one sorts their mail: each person signs in for themselves. */
function Model({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const { chosen, choices, signedIn } = state.model;
  const [changing, setChanging] = useState(false);
  const models = useLoaded(`models ${signedIn.join(' ')}`, (signal) => api.models(signal), 300_000);
  const month = useLoaded('summary-30', (signal) => api.summary(30, signal), 300_000);
  const provider = chosen?.split('/')[0] ?? null;
  const choice = choices.find((c) => c.provider === provider);
  const reachable = provider !== null && signedIn.includes(provider);
  const offered = [...new Set([...(chosen ? [chosen] : []), ...(models.data?.models ?? []).filter((m) => provider && m.startsWith(`${provider}/`))])];
  const others = signedIn.filter((p) => p !== provider);
  const spent = month.data?.totals;
  return (
    <SettingsGroup
      title="Model"
      note={
        spent && spent.decisions > 0 && chosen
          ? `Sorts what no rule covers. ${money(spent.costUsd)} in the last 30 days, for ${plural(spent.decisions - spent.withoutInference, 'message')}.`
          : 'Sorts what no rule covers. Without one, that mail waits for you.'
      }
    >
      <Sheet>
        {chosen && provider ? (
          <>
            <SettingRow
              title={providerName(choice, provider)}
              note={reachable ? choice?.how === 'chatgpt' ? 'Signed in.' : 'Key saved.' : <Failure>Not signed in. Change provider to sign in again.</Failure>}
            >
              <Button onClick={() => setChanging(true)}>Change provider</Button>
            </SettingRow>
            <SettingRow title="Model" note="A small one is usually enough.">
              <Select
                label="Model"
                value={chosen}
                options={offered.map((m) => [m, m.slice(provider.length + 1)] as const)}
                disabled={busy || !reachable}
                onChange={(model) => run(() => api.setModel(model), reload)}
              />
            </SettingRow>
          </>
        ) : (
          <SettingRow title="No model" note="Rules still sort what they cover.">
            <Button onClick={() => setChanging(true)}>Connect a model</Button>
          </SettingRow>
        )}
        {others.map((p) => (
          <SettingRow
            key={p}
            title={providerName(
              choices.find((c) => c.provider === p),
              p,
            )}
            note="Signed in, but not in use."
          >
            <Button variant="quiet" busy={busy} onClick={() => run(() => api.signOutModel(p), reload)}>
              Remove
            </Button>
          </SettingRow>
        ))}
      </Sheet>
      <Failure>{error}</Failure>
      {changing ? <ChangeProvider state={state} reload={reload} onClose={() => setChanging(false)} /> : null}
    </SettingsGroup>
  );
}

function Mailboxes({ state }: { state: ManageState }) {
  return (
    <SettingsGroup title="Mailboxes" note="Anyone signed in as one of these sees all of them.">
      <Sheet>
        {state.accounts.map((account) => (
          <SettingRow key={account.id} title={account.email} note={account.lastSyncedAt ? `Synced ${ago(account.lastSyncedAt)}` : 'Not synced yet'} />
        ))}
        <SettingRow title="Another Gmail account">
          <Button href="/auth/login?add=1">Connect</Button>
        </SettingRow>
      </Sheet>
      {state.owner ? <OlderMail /> : null}
    </SettingsGroup>
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
    <SettingsGroup title="Guidelines" note="In your words. The model reads them before each message.">
      <TextArea aria-label="Guidelines" value={text} maxLength={8000} onChange={(event) => setText(event.target.value)} />
      <div className="flex items-center gap-2">
        <Button
          variant="ink"
          busy={busy}
          disabled={text === stored}
          onClick={() =>
            run(
              () => api.saveGuidelines(text),
              () => setStored(text),
            )
          }
        >
          Save
        </Button>
        <Failure>{error}</Failure>
      </div>
    </SettingsGroup>
  );
}

function OlderMail() {
  const { busy, error, run } = useAction();
  const toast = useToast();
  const [days, setDays] = useState<(typeof DAYS)[number][0]>('7');
  return (
    <Sheet>
      <SettingRow
        title="Pull in older mail"
        note={
          <>
            Up to 300 messages from before sift started, as suggestions to teach it with, one model call each. Never acted on.
            <Failure>{error}</Failure>
          </>
        }
      >
        <Select label="How far back" value={days} options={DAYS} onChange={setDays} />
        <Button
          busy={busy}
          onClick={() =>
            run(async () => {
              const { added } = await api.backfill(Number(days));
              toast(
                added === 0 ? 'Nothing new in that period.' : `${plural(added, 'message')} pulled in`,
                added === 0 ? {} : { description: 'They show under Suggestions as sift decides them.' },
              );
            })
          }
        >
          Pull in
        </Button>
      </SettingRow>
    </Sheet>
  );
}

/** Kept in this browser, not in sift: it is about how this reader works, not how mail is sorted. */
function Keys() {
  const on = useShortcutsOn();
  return (
    <SettingsGroup title="This browser" note="Kept here, not in sift.">
      <Sheet>
        <SettingRow
          title="Keyboard shortcuts"
          note={
            <>
              <Kbd>?</Kbd> lists the ones that work where you are.
            </>
          }
        >
          <Button onClick={() => setShortcutsOn(!on)}>{on ? 'Turn off' : 'Turn on'}</Button>
        </SettingRow>
      </Sheet>
    </SettingsGroup>
  );
}

/** How sift runs, most used first. What it does with mail is under Labels and Rules. */
export function SettingsView() {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  return (
    <div className="flex max-w-5xl flex-col gap-10">
      <PageHeader title="Settings" />
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Loading rows={6} />
      ) : data ? (
        <>
          {/* How sift runs applies to everyone it sorts for, so it is the owner's to change. The server refuses anyone else. */}
          {data.owner ? <Sorting state={data} reload={reload} /> : null}
          {/* The model, its sign-in and the guidelines are each person's own. */}
          <Model state={data} reload={reload} />
          <Guidelines saved={data.guidelines} />
          <Mailboxes state={data} />
          <Keys />
        </>
      ) : null}
    </div>
  );
}
