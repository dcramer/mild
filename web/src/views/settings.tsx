import { useEffect, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, count, money, plural } from '@/lib/format.ts';
import {
  Button,
  Code,
  ConfirmButton,
  Copyable,
  Failure,
  Input,
  Kbd,
  Loading,
  Note,
  PageHeader,
  Section,
  Select,
  SettingRow,
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
    <Section title="Sorting">
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
            settings.act
              ? 'sift carries out its decisions in Gmail as each label says. Each change can be undone from Activity.'
              : 'sift only suggests. Nothing in Gmail changes until you let it act.'
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
    </Section>
  );
}

type Choice = ManageState['model']['choices'][number];

/** ChatGPT, signed in by a code entered at OpenAI: nothing has to come back to this server, so it works wherever sift runs. */
function ChatGPT({ choice, state, reload }: { choice: Choice; state: ManageState['model']; reload: () => void }) {
  const { busy, error, run } = useAction();
  const pending = state.pending;
  if (state.signedIn.includes(choice.provider))
    return (
      <SettingRow title={choice.label} note="Signed in. What it sorts is judged on your plan.">
        <Button busy={busy} onClick={() => run(() => api.signOutModel(choice.provider), reload)}>
          Sign out
        </Button>
      </SettingRow>
    );
  if (pending && 'code' in pending)
    return (
      <SettingRow
        title={choice.label}
        note={
          <>
            Enter this code at{' '}
            <TextLink href={pending.url} away>
              {new URL(pending.url).host}
            </TextLink>
            . This finishes by itself once you have.
          </>
        }
      >
        <Copyable value={pending.code} label="the code" />
      </SettingRow>
    );
  return (
    <SettingRow
      title={choice.label}
      note={
        <>
          With a ChatGPT Plus or Pro plan.
          <Failure>{error ?? (pending && 'error' in pending ? pending.error : null)}</Failure>
        </>
      }
    >
      <Button busy={busy} onClick={() => run(() => api.signInChatGPT(), reload)}>
        Sign in
      </Button>
    </SettingRow>
  );
}

/** A provider that takes an API key. The key is kept encrypted with the reader's own data and never shown again. */
function ApiKey({ choice, state, reload }: { choice: Choice; state: ManageState['model']; reload: () => void }) {
  const { busy, error, run } = useAction();
  const [key, setKey] = useState('');
  if (state.signedIn.includes(choice.provider))
    return (
      <SettingRow title={choice.label} note="Saved.">
        <Button busy={busy} onClick={() => run(() => api.signOutModel(choice.provider), reload)}>
          Remove
        </Button>
      </SettingRow>
    );
  return (
    <SettingRow title={choice.label} note={<Failure>{error}</Failure>}>
      <Input type="password" aria-label={choice.label} autoComplete="off" value={key} className="font-mono" onChange={(event) => setKey(event.target.value)} />
      <Button
        busy={busy}
        disabled={key.trim() === ''}
        onClick={() =>
          run(
            () => api.saveModelKey(choice.provider, key),
            () => (setKey(''), reload()),
          )
        }
      >
        Save
      </Button>
    </SettingRow>
  );
}

/** The reader's own way to a model and which one sorts their mail: each person signs in for themselves. */
function Model({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const { chosen, signedIn } = state.model;
  // Keyed by the sign-ins, so one added or removed (a ChatGPT one finishes in the background) asks again.
  const models = useLoaded(`models ${signedIn.join(' ')}`, (signal) => api.models(signal), 300_000);
  const month = useLoaded('summary-30', (signal) => api.summary(30, signal), 300_000);
  const recommended = models.data?.recommended ?? null;
  const offered = [...new Set([...(chosen ? [chosen] : []), ...(recommended ? [recommended] : []), ...(models.data?.models ?? [])])];
  const spent = month.data?.totals;
  const provider = chosen?.split('/')[0];
  const unreachable = provider && !signedIn.includes(provider) ? provider : null;
  return (
    <Section title="Model">
      <Sheet>
        {state.model.choices.map((choice) =>
          choice.how === 'chatgpt' ? (
            <ChatGPT key={choice.provider} choice={choice} state={state.model} reload={reload} />
          ) : (
            <ApiKey key={choice.provider} choice={choice} state={state.model} reload={reload} />
          ),
        )}
        <SettingRow
          title="Model"
          note={
            signedIn.length === 0
              ? 'Sorts what no rule covers, once you have signed in above. Without one, that mail waits for you.'
              : spent && spent.decisions > 0
                ? `Sorts what no rule covers. ${money(spent.costUsd)} in the last 30 days, for ${plural(spent.decisions - spent.withoutInference, 'message')}.`
                : 'Sorts what no rule covers.'
          }
        >
          <Select
            label="Model"
            value={chosen ?? ''}
            options={[['', 'No model'] as const, ...offered.map((m) => [m, m === recommended ? `${m} (recommended)` : m] as const)]}
            disabled={busy || (signedIn.length === 0 && chosen === null)}
            onChange={(model) => run(() => api.setModel(model === '' ? null : model), reload)}
          />
        </SettingRow>
      </Sheet>
      <Failure>{error ?? (unreachable ? `${chosen} needs a sign-in to ${unreachable}. Sign in above, or choose another.` : null)}</Failure>
    </Section>
  );
}

function Accounts({ state }: { state: ManageState }) {
  return (
    <Section title="Accounts" meta={count(state.accounts.length)} action={<Button href="/auth/login?add=1">Connect another</Button>}>
      <Sheet>
        {state.accounts.map((account) => (
          <SettingRow key={account.id} title={account.email} note={account.lastSyncedAt ? `Synced ${ago(account.lastSyncedAt)}` : 'Not synced yet'} />
        ))}
      </Sheet>
      <p className="text-muted-foreground">Anyone signed in as one of these sees all of them.</p>
    </Section>
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
    <Section
      title="Guidelines"
      meta="in your words; the model reads them before each message"
      action={
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
          {text === stored ? 'Saved' : 'Save'}
        </Button>
      }
    >
      <TextArea aria-label="Guidelines" value={text} maxLength={8000} onChange={(event) => setText(event.target.value)} />
      <Failure>{error}</Failure>
    </Section>
  );
}

function OlderMail() {
  const { busy, error, run } = useAction();
  const toast = useToast();
  const [days, setDays] = useState<(typeof DAYS)[number][0]>('7');
  return (
    <Section title="Older mail">
      <Sheet>
        <SettingRow
          title="Pull in as suggestions"
          note="sift only sorts mail that arrives after it starts. This brings in up to 300 older messages, one model call each, to teach it with. They are never acted on."
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
      <Failure>{error}</Failure>
    </Section>
  );
}

/** Kept in this browser, not in sift: it is about how this reader works, not how mail is sorted. */
function Keys() {
  const on = useShortcutsOn();
  return (
    <Section title="Keyboard">
      <Sheet>
        <SettingRow
          title="Shortcuts"
          note={
            <>
              Keys for moving through lists and answering, each shown beside what it presses. <Kbd>?</Kbd> lists the ones that work where you are. Remembered in
              this browser.
            </>
          }
        >
          <Button onClick={() => setShortcutsOn(!on)}>{on ? 'Turn off' : 'Turn on'}</Button>
        </SettingRow>
      </Sheet>
    </Section>
  );
}

/** How sift runs, most used first. What it does with mail is under Labels and Rules. */
export function SettingsView() {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  return (
    <div className="flex max-w-4xl flex-col gap-10">
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
          <Accounts state={data} />
          {data.owner ? <OlderMail /> : null}
          <Keys />
        </>
      ) : null}
    </div>
  );
}
