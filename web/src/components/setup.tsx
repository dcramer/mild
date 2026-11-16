import { useState } from 'react';
import { ProviderList, providerName, useProviderConnect } from '@/components/model-connect.tsx';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { plural } from '@/lib/format.ts';
import { Button, Dialog, Failure, Field, Form, Select, useToast } from '@/system';

const DISMISSED = 'sift-setup-dismissed';
const DAYS = [
  ['7', 'The last week'],
  ['14', 'The last 2 weeks'],
  ['30', 'The last month'],
] as const;

const dismissed = () => {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
};

/**
 * First sign-in with no model: connect one, then pull in recent mail to answer, without leaving
 * Suggestions. Closed, it does not come back in this browser; Settings does the same at any time.
 */
export function Setup() {
  const manage = useLoaded('manage', (signal) => api.manage(signal), 10_000);
  // Decided once, on the first state: signing in partway through must not close it.
  const [open, setOpen] = useState<boolean | null>(dismissed() ? false : null);
  const state = manage.data;
  if (open === null && state) setOpen(state.model.chosen === null && state.model.signedIn.length === 0);
  if (!open || !state) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // Without storage it asks again next time, which is no harm.
    }
    setOpen(false);
  };
  return <Steps state={state} reload={manage.reload} onClose={close} />;
}

function Steps({ state, reload, onClose }: { state: ManageState; reload: () => void; onClose: () => void }) {
  const [step, setStep] = useState<'model' | 'teach'>('model');
  const [picked, setPicked] = useState<ManageState['model']['choices'][number] | null>(null);
  // Pulling in older mail is the owner's: it spends model calls for the whole install.
  const steps = state.owner ? 2 : 1;
  const afterModel = () => (state.owner ? setStep('teach') : onClose());
  if (step === 'teach') return <Teach state={state} onClose={onClose} />;
  if (!picked)
    return (
      <Dialog
        open
        onClose={onClose}
        title="Connect a model"
        subtitle={`Step 1 of ${steps}. Rules sort what they cover; a model sorts the rest.`}
        footer={
          <Button variant="quiet" onClick={afterModel}>
            Skip: only rules will sort
          </Button>
        }
      >
        <ProviderList choices={state.model.choices} inUse={null} onChoose={setPicked} />
      </Dialog>
    );
  return (
    <Connect
      key={picked.provider}
      choice={picked}
      state={state}
      reload={reload}
      steps={steps}
      onBack={() => setPicked(null)}
      onDone={afterModel}
      onClose={onClose}
    />
  );
}

function Connect({
  choice,
  state,
  reload,
  steps,
  onBack,
  onDone,
  onClose,
}: {
  choice: ManageState['model']['choices'][number];
  state: ManageState;
  reload: () => void;
  steps: number;
  onBack: () => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const { fields, ready } = useProviderConnect(choice, state.model, reload);
  const { busy, error, run } = useAction();
  return (
    <Dialog
      open
      onClose={onClose}
      title={providerName(choice, choice.provider)}
      subtitle={`Step 1 of ${steps}`}
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={() => ready && run(() => api.setModel(ready), onDone)}>
            Continue
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

function Teach({ state, onClose }: { state: ManageState; onClose: () => void }) {
  const { busy, error, run } = useAction();
  const toast = useToast();
  const [days, setDays] = useState<(typeof DAYS)[number][0]>('7');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Teach it"
      subtitle="Step 2 of 2"
      footer={
        <>
          <Button
            variant="ink"
            busy={busy}
            onClick={() =>
              run(async () => {
                const { added } = await api.backfill(Number(days));
                toast(
                  added === 0 ? 'Nothing new in that period.' : `${plural(added, 'message')} pulled in`,
                  added === 0 ? {} : { description: 'They show here as sift decides them.' },
                );
                onClose();
              })
            }
          >
            Pull in and start answering
          </Button>
          <Button variant="quiet" onClick={onClose}>
            New mail only
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => {}}>
        <p className="text-base">
          sift learns from your answers. Pull in recent mail from {state.accounts.map((a) => a.email).join(' and ')} and say what each message is. Nothing in
          Gmail changes while you do.
        </p>
        <Field label="How far back" hint="Up to 300 messages, one model call each.">
          <Select label="How far back" value={days} options={DAYS} onChange={setDays} />
        </Field>
      </Form>
    </Dialog>
  );
}
