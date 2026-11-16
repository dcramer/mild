import { ArrowRightIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ProviderList, providerName, useProviderConnect } from '@/components/model-connect.tsx';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { plural } from '@/lib/format.ts';
import { Button, Entry, Failure, Field, Form, Select, useToast } from '@/system';

type Choice = ManageState['model']['choices'][number];

const DAYS = [
  ['7', 'The last week'],
  ['14', 'The last 2 weeks'],
  ['30', 'The last month'],
] as const;

/**
 * Nothing of the dashboard shows until a model is in use: without one, only rules label mail, and there is
 * nothing to suggest. The same steps come back, under another heading, when the model in use is lost
 * (its sign-in removed or expired). Settings opens over it.
 */
export function ModelWall({ signedInAs, onSettings, children }: { signedInAs: string | null; onSettings: () => void; children: ReactNode }) {
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  // Connecting a model lifts the wall at the next load, so the step after it is held here.
  const [teaching, setTeaching] = useState(false);
  const state = manage.data;
  // Until it is known, the dashboard draws its loading screens: almost everyone has a model, and the wall is only met once.
  if (!state) return children;
  const inUse = state.model.chosen?.split('/')[0] ?? null;
  const walled = inUse === null || !state.model.signedIn.includes(inUse);
  if (!walled && !teaching) return children;
  const account = signedInAs ? { name: signedInAs, onSettings, onSignOut: () => void api.signOut().then(() => window.location.assign('/')) } : undefined;
  return (
    <Entry {...(account ? { account } : {})}>
      {teaching ? (
        <Teach state={state} onDone={() => setTeaching(false)} />
      ) : (
        <Connect
          state={state}
          lost={inUse}
          reload={manage.reload}
          // Pulling in older mail is the owner's (it spends model calls for the whole install), and only worth it for someone starting out.
          onConnected={() => {
            if (state.owner && inUse === null) setTeaching(true);
            manage.reload();
          }}
        />
      )}
    </Entry>
  );
}

function Connect({ state, lost, reload, onConnected }: { state: ManageState; lost: string | null; reload: () => void; onConnected: () => void }) {
  const [picked, setPicked] = useState<Choice | null>(null);
  if (picked) return <Provider key={picked.provider} choice={picked} state={state} reload={reload} onBack={() => setPicked(null)} onDone={onConnected} />;
  const was = lost
    ? providerName(
        state.model.choices.find((c) => c.provider === lost),
        lost,
      )
    : null;
  return (
    <>
      <p className="statement">{was ? 'No model connected.' : 'Connect a model.'}</p>
      <p className="text-muted-foreground">
        {was
          ? `${was} is signed out, so nothing new is classified or suggested. Rules still label what they cover.`
          : 'It reads the mail no rule covers and says which of your labels it is. Nothing in Gmail changes until you let it.'}
      </p>
      <ProviderList choices={state.model.choices} inUse={null} onChoose={setPicked} />
    </>
  );
}

function Provider({
  choice,
  state,
  reload,
  onBack,
  onDone,
}: {
  choice: Choice;
  state: ManageState;
  reload: () => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const { fields, ready } = useProviderConnect(choice, state.model, reload);
  const { busy, error, run } = useAction();
  return (
    <>
      <p className="statement">{providerName(choice, choice.provider)}</p>
      {fields}
      <Onward
        label="Continue"
        busy={busy}
        disabled={!ready}
        onPress={() => ready && run(() => api.setModel(ready), onDone)}
        back={{ label: 'Back', onPress: onBack }}
      />
      <Failure>{error}</Failure>
    </>
  );
}

function Teach({ state, onDone }: { state: ManageState; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const toast = useToast();
  const [days, setDays] = useState<(typeof DAYS)[number][0]>('7');
  return (
    <>
      <p className="statement">Teach it.</p>
      <p className="text-muted-foreground">
        Sift learns from your answers. Pull in recent mail from {state.accounts.map((a) => a.email).join(' and ')} and say what each message is.
      </p>
      <Form onSubmit={() => {}}>
        <Field label="How far back" hint="Up to 300 messages, one model call each.">
          <Select label="How far back" value={days} options={DAYS} onChange={setDays} />
        </Field>
      </Form>
      <Onward
        label="Pull in mail"
        busy={busy}
        onPress={() =>
          run(async () => {
            await api.backfill(Number(days));
            toast(`Pulling in the last ${plural(Number(days), 'day')}`);
            onDone();
          })
        }
        back={{ label: 'New mail only', onPress: onDone }}
      />
      <Failure>{error}</Failure>
    </>
  );
}

/** How a step ends: the one thing to press, and the other way out. */
function Onward({
  label,
  busy,
  disabled = false,
  onPress,
  back,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
  back: { label: string; onPress: () => void };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="mark" size="lg" busy={busy} disabled={disabled} onClick={onPress}>
        {label}
        <ArrowRightIcon aria-hidden />
      </Button>
      <Button variant="quiet" size="lg" onClick={back.onPress}>
        {back.label}
      </Button>
    </div>
  );
}
