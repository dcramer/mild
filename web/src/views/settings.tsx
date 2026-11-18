import { Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { GoThroughInbox, InboxRow } from '@/components/inbox.tsx';
import { ProviderList, providerName, useProviderConnect } from '@/components/model-connect.tsx';
import { costLine, spentLine, subscription } from '@/lib/prices.ts';
import { type ManageState, type Removed, api, useAction, useLoaded } from '@/lib/api.ts';
import { ago } from '@/lib/format.ts';
import { useParam } from '@/lib/route.ts';
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

/** Whether sift is on for the reader's own mail: what they come to Settings for first. */
function Active({ state, reload }: { state: ManageState; reload: () => void }) {
  const { busy, error, run } = useAction();
  const { active, activity } = state;
  const [goingThrough, setGoingThrough] = useState(false);
  const save = (active: boolean) =>
    run(
      () => api.setActive(active),
      () => {
        reload();
        // What is already in the inbox stays as it was unless Sift goes through it now.
        if (active && !state.inbox.going) setGoingThrough(true);
      },
    );

  return (
    <SettingsGroup title="Active" note="Whether Sift changes your Gmail.">
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
                Sift carries out its decisions in Gmail as each label says. Each change can be undone from <TextLink href="/activity">Activity</TextLink>.
              </>
            ) : (
              'Nothing in Gmail changes. Sift suggests, and learns from your answers.'
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
        <InboxRow state={state} reload={reload} onGoThrough={() => setGoingThrough(true)} />
        {activity.running ? (
          <SettingRow title="Check for mail" note={activity.lastPassAt ? `Last checked ${ago(activity.lastPassAt)}.` : 'Starting.'}>
            <Button disabled={busy} onClick={() => run(() => api.checkNow(), reload)}>
              Check now
            </Button>
          </SettingRow>
        ) : null}
      </Sheet>
      <Failure>{error}</Failure>
      {goingThrough ? <GoThroughInbox model={state.model} onClose={() => setGoingThrough(false)} onStarted={reload} /> : null}
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
  const step = useProviderConnect(choice, state.model, reload);
  const { ready, next } = step;
  const { busy, error, run } = useAction();
  const toast = useToast();
  const old = state.model.chosen?.split('/')[0] ?? null;
  const name = providerName(choice, choice.provider);
  const doSwitch = () =>
    run(async () => {
      if (!ready) return;
      // The new model first, so something always classifies; the old sign-in goes once nothing uses it.
      await api.setModel(ready);
      if (old && old !== choice.provider) await api.signOutModel(old);
      toast(`Now classifying with ${name}`);
      reload();
      onClose();
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title={step.title}
      subtitle={subtitle}
      footer={
        <>
          {next ? (
            <Button
              variant="ink"
              busy={next.busy ?? false}
              onClick={next.onPress}
              {...(next.href !== undefined && !next.disabled ? { href: next.href, target: '_blank', rel: 'noreferrer' } : { disabled: next.disabled ?? false })}
            >
              {next.label}
            </Button>
          ) : (
            <Button variant="ink" busy={busy} disabled={!ready} onClick={doSwitch}>
              Switch to {name}
            </Button>
          )}
          <Button variant="quiet" onClick={onBack}>
            Back
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      {step.body}
    </Dialog>
  );
}

/** The reader's own way to a model and which one classifies their mail: each person signs in for themselves. */
function Model({ state, reload, onConnect }: { state: ManageState; reload: () => void; onConnect: () => void }) {
  const { busy, error, run } = useAction();
  const { chosen, choices, signedIn } = state.model;
  const [changing, setChanging] = useState(false);
  const models = useLoaded(`models ${signedIn.join(' ')}`, (signal) => api.models(signal), 300_000);
  const month = useLoaded('summary-30', (signal) => api.summary(30, signal), 300_000);
  const provider = chosen?.split('/')[0] ?? null;
  const choice = choices.find((c) => c.provider === provider);
  // Connecting a model is SetUp's Connect step, under this panel: the button closes the panel onto it.
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
          ? `Classifies what no rule covers. ${spentLine(spent.costUsd, spent.judged, subscription(state.model))}`
          : 'Classifies what no rule covers.'
      }
    >
      <Sheet>
        <SettingRow title={providerName(choice, provider)} note={choice?.how === 'key' ? 'Key saved.' : 'Signed in.'}>
          <Button onClick={() => setChanging(true)}>Change provider</Button>
        </SettingRow>
        <SettingRow title="Model" note={costLine(choice, models.data?.costs ?? {}, chosen)}>
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

/**
 * A person's only mailbox is how they sign in, so it is never removed on its own: that is deleting the
 * account. Removing the one they are signed in as, with others left, ends their session.
 */
function RemoveMailbox({
  email,
  signedIn,
  last,
  onRemoved,
}: {
  email: string;
  signedIn: boolean;
  last: boolean;
  onRemoved: (notRevoked: string | null) => void;
}) {
  const [removing, setRemoving] = useState(false);
  return (
    <>
      <Button
        variant="quiet"
        size="icon"
        aria-label={`Remove ${email}`}
        disabled={last}
        {...(last ? { why: 'You cannot delete your only remaining mailbox.' } : { title: 'Remove' })}
        onClick={() => setRemoving(true)}
      >
        <Trash2Icon />
      </Button>
      {removing ? (
        <ConfirmRemoval
          title={`Remove ${email}`}
          confirm={email}
          action="Remove mailbox"
          send={() => api.removeMailbox(email)}
          onDone={onRemoved}
          onClose={() => setRemoving(false)}
        >
          Sift stops reading it, revokes its access at Google, and deletes everything it recorded about its mail: decisions and answers. Your labels and rules
          stay, for your other mailboxes.
          {signedIn ? ' You are signed in as it, so you will be signed out.' : ''}
        </ConfirmRemoval>
      ) : null}
    </>
  );
}

function Mailboxes({ state, signedInAs, reload }: { state: ManageState; signedInAs: string | null; reload: () => void }) {
  // Kept on the page, not in a toast: it asks the reader to do something at Google, and a toast would go before it was done.
  const [notRevoked, setNotRevoked] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const primary = state.accounts.find((a) => a.primary)?.email;
  // Google's return, when adding one did not work out.
  const [failed] = useParam('signin');
  return (
    <SettingsGroup title="Mailboxes" note="Anyone signed in as one of these sees all of them.">
      <Sheet>
        {state.accounts.map((account) => (
          <SettingRow
            key={account.id}
            title={account.email}
            note={`${account.lastSyncedAt ? `Synced ${ago(account.lastSyncedAt)}` : 'Not synced yet'}${account.email === signedInAs ? ' · Signed in as this one' : ''}`}
          >
            <RemoveMailbox
              email={account.email}
              signedIn={account.email === signedInAs}
              last={state.accounts.length === 1}
              onRemoved={(note) => {
                setNotRevoked(note);
                reload();
              }}
            />
          </SettingRow>
        ))}
        <SettingRow title="Another Gmail account" note={failed ? <Failure>{failed}</Failure> : undefined}>
          <Button href="/auth/login?add=1">Connect</Button>
        </SettingRow>
      </Sheet>
      {state.accounts.length > 1 && primary ? (
        <Sheet>
          <SettingRow
            title="Primary mailbox"
            note={
              <>
                Your account goes by it, whichever one you sign in with. If it is removed, the one connected longest takes its place.
                <Failure>{error}</Failure>
              </>
            }
          >
            <Select
              label="Primary mailbox"
              value={primary}
              options={state.accounts.map((a) => [a.email, a.email] as const)}
              disabled={busy}
              onChange={(email) => run(() => api.makePrimary(email), reload)}
            />
          </SettingRow>
        </Sheet>
      ) : null}
      {notRevoked ? (
        <Note tone="failure" title="Sift still has access at Google">
          <p>{notRevoked}</p>
        </Note>
      ) : null}
    </SettingsGroup>
  );
}

/** Said after a removal when Google could not be reached: sift's access there stays until they take it away. */
const notRevoked = (reply: Removed) =>
  reply.notRevoked.length === 0
    ? null
    : `Google could not be reached, so ${reply.notRevoked.join(' and ')} still lists Sift as having access. Remove it under Third-party connections in your Google Account.`;

/** Typing the address is the confirmation, since nothing brings it back. */
function ConfirmRemoval({
  title,
  confirm,
  action,
  send,
  onDone,
  onClose,
  children,
}: {
  title: string;
  confirm: string;
  action: string;
  send: () => Promise<Removed>;
  onDone?: (notRevoked: string | null) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  const { busy, error, run } = useAction();
  const submit = () =>
    run(async () => {
      const reply = await send();
      const note = notRevoked(reply);
      // Never settles, so nothing is fetched again with the session just ended while the page leaves.
      if (reply.signedOut) return new Promise<never>(() => window.location.assign(note ? `/?signin=${encodeURIComponent(note)}` : '/'));
      onClose();
      onDone?.(note);
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={typed.trim() !== confirm} onClick={submit}>
            {action}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => typed.trim() === confirm && submit()}>
        <p className="text-base">
          {children} The filters Sift made in Gmail stay there, as do its labels on your mail; delete the filters in Gmail’s settings if you no longer want
          them. This cannot be undone.
        </p>
        <Field label={`Type ${confirm} to confirm`}>
          <Input aria-label="The address" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
        </Field>
      </Form>
    </Dialog>
  );
}

/** Everything sift holds for this person goes, and they are signed out. */
function DeleteAccount({ email, onClose }: { email: string; onClose: () => void }) {
  return (
    <ConfirmRemoval title="Delete your account" confirm={email} action="Delete everything" send={() => api.deleteAccount(email)} onClose={onClose}>
      Sift stops reading every mailbox, revokes its access at Google, and deletes everything it recorded: decisions, answers, rules, labels and your model
      sign-in.
    </ConfirmRemoval>
  );
}

function Account({ state, signedInAs }: { state: ManageState; signedInAs: string | null }) {
  const [deleting, setDeleting] = useState(false);
  const email = state.accounts.find((a) => a.primary)?.email ?? signedInAs ?? state.accounts[0]?.email ?? '';
  return (
    <SettingsGroup title="Your account">
      <Sheet>
        <SettingRow
          title="Delete your account"
          note={`Sift stops reading every mailbox, and everything it recorded is deleted.${state.owner ? ' Others signed in to this Sift keep theirs.' : ''}`}
        >
          <Button onClick={() => setDeleting(true)}>Delete account…</Button>
        </SettingRow>
      </Sheet>
      {deleting ? <DeleteAccount email={email} onClose={() => setDeleting(false)} /> : null}
    </SettingsGroup>
  );
}

/** Kept in this browser, not in sift: it is about how this reader works, not how mail is classified. */
function Keys() {
  const on = useShortcutsOn();
  return (
    <SettingsGroup title="This browser" note="Kept here, not in Sift.">
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
/** Settings, over whatever is showing. Opened from the account menu, or from the setting-up page, so nothing has to be set up first. */
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
            <Mailboxes state={data} signedInAs={signedInAs} reload={reload} />
            <Keys />
            <Account state={data} signedInAs={signedInAs} />
          </>
        ) : null}
      </div>
    </Panel>
  );
}
