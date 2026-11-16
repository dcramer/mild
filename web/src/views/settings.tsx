import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { ProviderList, providerName, useProviderConnect } from '@/components/model-connect.tsx';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago, money, plural } from '@/lib/format.ts';
import {
  Button,
  ConfirmButton,
  Dialog,
  Failure,
  Field,
  Form,
  Input,
  Kbd,
  Loading,
  Note,
  Panel,
  Select,
  SettingRow,
  SettingsGroup,
  Sheet,
  TextLink,
  setShortcutsOn,
  useShortcutsOn,
  useToast,
} from '@/system';

const DAYS = [
  ['1', 'The last day'],
  ['3', 'The last 3 days'],
  ['7', 'The last week'],
  ['14', 'The last 2 weeks'],
  ['30', 'The last month'],
] as const;

/** Whether sift is on for the reader's own mail: what they come to Settings for first. */
function Active({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const { active, activity } = state;
  const save = (active: boolean) => run(() => api.setActive(active), reload);

  return (
    <SettingsGroup title="Active" note="Whether sift changes your Gmail.">
      {activity.problems.length > 0 ? (
        <Note tone="failure" title="Not working">
          {activity.problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </Note>
      ) : null}
      <Sheet>
        <SettingRow
          title={active ? 'On' : 'Off'}
          note={
            active ? (
              <>
                sift carries out its decisions in Gmail as each label says. Each change can be undone from <TextLink href="/activity">Activity</TextLink>.
              </>
            ) : (
              'Nothing in Gmail changes. sift suggests, and learns from your answers.'
            )
          }
        >
          {active ? (
            <Button busy={busy} onClick={() => save(false)}>
              Turn off
            </Button>
          ) : (
            <ConfirmButton variant="plain" question="Archive, label and mark spam on new mail by itself?" busy={busy} onConfirm={() => save(true)}>
              Turn on
            </ConfirmButton>
          )}
        </SettingRow>
        {activity.running ? (
          <SettingRow title="Check for mail" note={activity.lastPassAt ? `Last checked ${ago(activity.lastPassAt)}.` : 'Starting.'}>
            <Button disabled={busy} onClick={() => run(() => api.checkNow(), reload)}>
              Check now
            </Button>
          </SettingRow>
        ) : null}
      </Sheet>
      <Failure>{error}</Failure>
    </SettingsGroup>
  );
}

/** Change the provider: choose, sign in, try a model, switch. Until the switch, the one in use goes on classifying. */
function ChangeProvider({ state, reload, onClose }: { state: ManageState; reload: () => void; onClose: () => void }) {
  const { choices, chosen } = state.model;
  const inUse = chosen?.split('/')[0] ?? null;
  const [picked, setPicked] = useState<(typeof choices)[number] | null>(null);
  const subtitle = `${providerName(
    choices.find((c) => c.provider === inUse),
    inUse ?? '',
  )} stays in use until you switch.`;
  if (!picked)
    return (
      <Dialog open onClose={onClose} title="Change provider" subtitle={subtitle}>
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
  subtitle: string;
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
      toast(`Now classifying with ${name}.`);
      reload();
      onClose();
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title={name}
      subtitle={subtitle}
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
function Model({ state, reload, onConnect }: { state: ManageState; reload: () => void; onConnect: () => void }) {
  const { busy, error, run } = useAction();
  const { chosen, choices, signedIn } = state.model;
  const [changing, setChanging] = useState(false);
  const models = useLoaded(`models ${signedIn.join(' ')}`, (signal) => api.models(signal), 300_000);
  const month = useLoaded('summary-30', (signal) => api.summary(30, signal), 300_000);
  const provider = chosen?.split('/')[0] ?? null;
  const choice = choices.find((c) => c.provider === provider);
  // Connecting a model is the wall under this panel.
  if (chosen === null || provider === null || !signedIn.includes(provider))
    return (
      <SettingsGroup title="Model" note="Classifies what no rule covers.">
        <Sheet>
          <SettingRow title="No model connected" note="Nothing new is classified or suggested. Rules still label what they cover.">
            <Button onClick={onConnect}>Connect a model</Button>
          </SettingRow>
        </Sheet>
      </SettingsGroup>
    );
  const offered = [...new Set([chosen, ...(models.data?.models ?? []).filter((m) => m.startsWith(`${provider}/`))])];
  const others = signedIn.filter((p) => p !== provider);
  const spent = month.data?.totals;
  return (
    <SettingsGroup
      title="Model"
      note={
        spent && spent.costUsd > 0
          ? `Classifies what no rule covers. ${money(spent.costUsd)} in the last 30 days, for ${plural(spent.judged, 'message')}.`
          : 'Classifies what no rule covers.'
      }
    >
      <Sheet>
        <SettingRow title={providerName(choice, provider)} note={choice?.how === 'key' ? 'Key saved.' : 'Signed in.'}>
          <Button onClick={() => setChanging(true)}>Change provider</Button>
        </SettingRow>
        <SettingRow title="Model" note="A small one is usually enough.">
          <Select
            label="Model"
            value={chosen}
            options={offered.map((m) => [m, m.slice(provider.length + 1)] as const)}
            disabled={busy}
            onChange={(model) => run(() => api.setModel(model), reload)}
          />
        </SettingRow>
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

// There is no API to remove a mailbox or delete an account yet (TODO.md); these say so when pressed.
const NOT_BUILT = 'Not built yet: there is no API for this.';

/**
 * A person's last mailbox is how they sign in, so removing it is deleting their account, and asks the
 * same way. Removing the one they are signed in as, with others left, ends their session.
 */
function RemoveMailbox({ email, signedIn, last }: { email: string; signedIn: boolean; last: boolean }) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  if (last)
    return (
      <>
        <Button variant="quiet" size="icon" aria-label="Remove" title="Remove" onClick={() => setDeleting(true)}>
          <Trash2Icon />
        </Button>
        {deleting ? <DeleteAccount email={email} onClose={() => setDeleting(false)} /> : null}
      </>
    );
  return (
    <ConfirmButton
      icon={<Trash2Icon />}
      question={`Remove ${email}, and delete what sift recorded about its mail?${signedIn ? ' You are signed in as it, so you will be signed out.' : ''}`}
      onConfirm={() => toast(NOT_BUILT)}
    >
      Remove
    </ConfirmButton>
  );
}

function Mailboxes({ state, signedInAs }: { state: ManageState; signedInAs: string | null }) {
  return (
    <SettingsGroup title="Mailboxes" note="Anyone signed in as one of these sees all of them.">
      <Sheet>
        {state.accounts.map((account) => (
          <SettingRow
            key={account.id}
            title={account.email}
            note={`${account.lastSyncedAt ? `Synced ${ago(account.lastSyncedAt)}` : 'Not synced yet'}${account.email === signedInAs ? ' · Signed in as this one' : ''}`}
          >
            <RemoveMailbox email={account.email} signedIn={account.email === signedInAs} last={state.accounts.length === 1} />
          </SettingRow>
        ))}
        <SettingRow title="Another Gmail account">
          <Button href="/auth/login?add=1">Connect</Button>
        </SettingRow>
      </Sheet>
      {state.owner ? <OlderMail /> : null}
    </SettingsGroup>
  );
}

/** Everything sift holds for this person goes, and they are signed out. Typing the address is the confirmation, since nothing brings it back. */
function DeleteAccount({ email, onClose }: { email: string; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete your account"
      footer={
        <>
          <Button variant="ink" disabled={typed.trim() !== email} onClick={() => setError(NOT_BUILT)}>
            Delete everything
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => {}}>
        <p className="text-base">
          sift stops reading every mailbox, and everything it recorded is deleted: decisions, answers, rules, labels and your model sign-in. The filters sift
          made in Gmail are removed; the changes it made to mail, and its labels on it, stay. This cannot be undone.
        </p>
        <Field label={`Type ${email} to confirm`}>
          <Input aria-label="Your address" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
        </Field>
      </Form>
    </Dialog>
  );
}

function Account({ state, signedInAs }: { state: ManageState; signedInAs: string | null }) {
  const [deleting, setDeleting] = useState(false);
  const email = signedInAs ?? state.accounts[0]?.email ?? '';
  return (
    <SettingsGroup title="Your account">
      <Sheet>
        <SettingRow
          title="Delete your account"
          note={`sift stops reading every mailbox, and everything it recorded is deleted.${state.owner ? ' Others signed in to this sift keep theirs.' : ''}`}
        >
          <Button onClick={() => setDeleting(true)}>Delete account…</Button>
        </SettingRow>
      </Sheet>
      {deleting ? <DeleteAccount email={email} onClose={() => setDeleting(false)} /> : null}
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
/** Settings, over whatever is showing. Opened from the account menu, or from under the model wall, so nothing has to be set up first. */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { data, error, loading, reload } = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  const session = useLoaded('session', (signal) => api.session(signal), 300_000);
  const signedInAs = session.data?.email ?? null;
  return (
    <Panel open onClose={onClose} title="Settings">
      <div className="flex flex-col gap-10">
        {error ? <ErrorNote message={error} /> : null}
        {loading ? (
          <Loading rows={6} />
        ) : data ? (
          <>
            {/* Whether sift is on, the model and its sign-in are each person's own. */}
            <Active state={data} reload={reload} />
            <Model state={data} reload={reload} onConnect={onClose} />
            <Mailboxes state={data} signedInAs={signedInAs} />
            <Keys />
            <Account state={data} signedInAs={signedInAs} />
          </>
        ) : null}
      </div>
    </Panel>
  );
}
