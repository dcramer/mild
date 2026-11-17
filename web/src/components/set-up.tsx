import { ArrowRightIcon, ArrowUpRightIcon, PlusIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type Next, ProviderList, providerName, useProviderConnect } from '@/components/model-connect.tsx';
import { type LabelProposal, type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { plural } from '@/lib/format.ts';
import { Button, Dialog, Failure, Field, Form, Onboarding, Select, TextArea, useToast } from '@/system';
import { type LabelDraft, LabelFields } from '@/views/label-panel.tsx';
import { type Suggestion, SuggestionList, keepWord, keptLabels, suggestionOf } from '@/components/label-suggestions.tsx';

type Choice = ManageState['model']['choices'][number];
type Account = { name: string; onSettings: () => void; onSignOut: () => void } | undefined;

/** Things people want of their inbox, to start from. Each one goes once its words are in the box, and the next takes its place. */
const EXAMPLES = [
  'Get sales pitches out of my inbox',
  'Never miss mail from a person',
  'Keep receipts out of the way',
  'Quiet the notifications from tools I use',
  'Catch scams and phishing',
  'Keep recruiters out of my inbox',
  'Never miss a bill or a failed payment',
  'Keep shipping updates out of the way',
  'Keep security alerts about my accounts where I see them',
  'Unsubscribe me from lists I never signed up for',
  'Keep calendar invitations from people',
  'Archive automated reports and digests',
  'Keep mail that asks me to review or approve something',
  'Archive social network notifications',
  'Keep mail from my kids’ school',
  'Keep replies to emails I sent',
  'Keep newsletters I read, and archive the rest',
  'Archive surveys and feedback requests',
];
/** How many to offer at once. */
const OFFERED = 6;

const DAYS = [
  ['7', 'The last week'],
  ['14', 'The last 2 weeks'],
  ['30', 'The last month'],
] as const;

/**
 * Nothing of the dashboard shows until Sift can work: a model in use, and labels in every mailbox (Sift
 * reads nothing from a mailbox without them). The steps come in order; one already done is ticked and
 * skipped. A model that is lost later (its sign-in removed or expired) brings back only that step. The
 * owner, once their labels are made, may pull in older mail. Settings opens over it.
 */
export function SetUp({ signedInAs, onSettings, children }: { signedInAs: string | null; onSettings: () => void; children: ReactNode }) {
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  const proposal = useLoaded('labelProposal', (signal) => api.labelProposal(signal), 300_000);
  // Each press moves to the next step itself rather than waiting for the next load, which would show a step
  // from before it: suggestions just made, labels just made, older mail asked for.
  const [fresh, setFresh] = useState<LabelProposal | null>(null);
  const [asking, setAsking] = useState(false);
  const [made, setMade] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const state = manage.data;
  // Nothing until it is known which: the dashboard drawn first would be replaced by a step a moment later.
  if (!state) return manage.error ? children : null;
  const inUse = state.model.chosen?.split('/')[0] ?? null;
  const walled = inUse === null || !state.model.signedIn.includes(inUse);
  const bare = !made && state.accounts.some((a) => !(state.labels[a.id] ?? []).some((l) => l.gmailLabel !== null));
  if (!walled && !bare && !teaching) return children;
  const account: Account = signedInAs
    ? { name: signedInAs, onSettings, onSignOut: () => void api.signOut().then(() => window.location.assign('/')) }
    : undefined;
  const steps = ['Connect a model', 'What you want', 'Your labels', ...(state.owner ? ['Older mail'] : [])];
  // A model signed out after setting up is the only thing to do: no steps.
  const lost = walled && !bare && inUse !== null;

  if (walled) return <Connect state={state} lost={lost ? inUse : null} steps={lost ? undefined : steps} account={account} reload={manage.reload} />;
  if (teaching) return <Teach state={state} steps={steps} account={account} onDone={() => setTeaching(false)} />;
  // Suggestions kept from an earlier visit decide the step, so it waits for them.
  if (!proposal.data && !proposal.error && !fresh) return null;
  const suggested = fresh ?? proposal.data?.proposal ?? null;
  if (suggested && !asking)
    return (
      <Labels
        key={suggested.id}
        proposal={suggested}
        steps={steps}
        account={account}
        onStartOver={() => setAsking(true)}
        onDone={() => {
          setMade(true);
          if (state.owner) setTeaching(true);
        }}
      />
    );
  return (
    <Want
      start={suggested?.goal ?? ''}
      steps={steps}
      account={account}
      onSuggested={(next) => {
        setFresh(next);
        setAsking(false);
      }}
    />
  );
}

function Connect({
  state,
  lost,
  steps,
  account,
  reload,
}: {
  state: ManageState;
  lost: string | null;
  steps: readonly string[] | undefined;
  account: Account;
  reload: () => void;
}) {
  const [picked, setPicked] = useState<Choice | null>(null);
  if (picked)
    return <Provider key={picked.provider} choice={picked} state={state} steps={steps} account={account} reload={reload} onBack={() => setPicked(null)} />;
  const was = lost
    ? providerName(
        state.model.choices.find((c) => c.provider === lost),
        lost,
      )
    : null;
  return (
    <Onboarding
      {...(steps ? { steps } : {})}
      title={was ? 'No model connected' : 'Connect a model'}
      intro={
        was
          ? `${was} is signed out, so nothing new is classified or suggested. Rules still label what they cover.`
          : 'It reads the mail no rule covers and says which of your labels it is. Nothing in Gmail changes until you let it.'
      }
      account={account}
    >
      <ProviderList choices={state.model.choices} inUse={null} onChoose={setPicked} />
    </Onboarding>
  );
}

function Provider({
  choice,
  state,
  steps,
  account,
  reload,
  onBack,
}: {
  choice: Choice;
  state: ManageState;
  steps: readonly string[] | undefined;
  account: Account;
  reload: () => void;
  onBack: () => void;
}) {
  const step = useProviderConnect(choice, state.model, reload);
  const { busy, error, run } = useAction();
  const ready = step.ready;
  return (
    <Onboarding {...(steps ? { steps } : {})} title={step.title} account={account}>
      {step.body}
      <Onward
        next={step.next ?? { label: 'Continue', busy, disabled: !ready, onPress: () => ready && run(() => api.setModel(ready), reload) }}
        back={{ label: 'Back', onPress: onBack }}
        error={error}
      />
    </Onboarding>
  );
}

function Want({
  start,
  steps,
  account,
  onSuggested,
}: {
  start: string;
  steps: readonly string[];
  account: Account;
  onSuggested: (proposal: LabelProposal) => void;
}) {
  const [goal, setGoal] = useState(start);
  const { busy, error, run } = useAction();
  const ready = goal.trim() !== '';
  const suggest = () => ready && run(async () => onSuggested(await api.proposeLabels(goal.trim())));
  return (
    <Onboarding
      steps={steps}
      current={1}
      title="What do you want from Sift?"
      intro="Say it in your own words, and Sift suggests labels for it. Each says what a kind of mail is and what Sift does with it. Mail none of them fits stays in your inbox."
      account={account}
    >
      <Form onSubmit={suggest}>
        <TextArea
          aria-label="What do you want from Sift?"
          className="min-h-32"
          maxLength={2000}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
        />
        <ul className="-ml-3 flex flex-col items-start" aria-label="Examples">
          {EXAMPLES.filter((example) => !goal.toLowerCase().includes(example.toLowerCase()))
            .slice(0, OFFERED)
            .map((example) => (
              <li key={example}>
                <Button variant="quiet" onClick={() => setGoal((g) => (g.trim() ? `${g.trim()} ${example}.` : `${example}.`))}>
                  <PlusIcon aria-hidden />
                  {example}
                </Button>
              </li>
            ))}
        </ul>
      </Form>
      <Onward next={{ label: 'Suggest labels', busy, disabled: !ready, onPress: suggest }} error={error} waiting={busy ? 'This can take a minute.' : null} />
    </Onboarding>
  );
}

function Labels({
  proposal,
  steps,
  account,
  onStartOver,
  onDone,
}: {
  proposal: LabelProposal;
  steps: readonly string[];
  account: Account;
  onStartOver: () => void;
  onDone: () => void;
}) {
  const [suggestions, setSuggestions] = useState(() => proposal.drafts.map(suggestionOf));
  const [editing, setEditing] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  const kept = keptLabels(suggestions);
  const change = (index: number, next: Partial<Suggestion>) => setSuggestions((all) => all.map((d, i) => (i === index ? { ...d, ...next } : d)));
  const use = () => kept.length > 0 && run(() => api.acceptLabels(kept), onDone);
  return (
    <Onboarding steps={steps} current={2} title="Your labels" intro={`“${proposal.goal}”`} account={account}>
      <SuggestionList suggestions={suggestions} onChange={change} onEdit={setEditing} />
      <Onward
        next={{
          label: keepWord('Use', kept.length),
          busy,
          disabled: kept.length === 0,
          onPress: use,
        }}
        back={{ label: 'Start over', onPress: onStartOver }}
        error={error}
      />
      {editing === null ? null : (
        <EditDraft
          draft={suggestions[editing]}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            change(editing, draft);
            setEditing(null);
          }}
        />
      )}
    </Onboarding>
  );
}

/** A suggestion changed before it is made: the fields a label has on the Labels screen. */
function EditDraft({ draft: start, onClose, onSave }: { draft: LabelDraft; onClose: () => void; onSave: (draft: LabelDraft) => void }) {
  const [draft, setDraft] = useState(start);
  const ready = draft.name.trim() !== '';
  const save = () => ready && onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
  return (
    <Dialog
      open
      onClose={onClose}
      title={start.name}
      footer={
        <>
          <Button variant="ink" disabled={!ready} onClick={save}>
            Done
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <Form onSubmit={save}>
        <LabelFields draft={draft} onChange={setDraft} />
      </Form>
    </Dialog>
  );
}

function Teach({ state, steps, account, onDone }: { state: ManageState; steps: readonly string[]; account: Account; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const toast = useToast();
  const [days, setDays] = useState<(typeof DAYS)[number][0]>('7');
  return (
    <Onboarding
      steps={steps}
      current={3}
      title="Older mail"
      intro={`Sift reads new mail from now on. Pull in recent mail from ${new Intl.ListFormat('en', { type: 'conjunction' }).format(state.accounts.map((a) => a.email))} as well, and answer what Sift says about it: it learns from your answers.`}
      account={account}
    >
      <Form onSubmit={() => {}}>
        <Field label="How far back" hint="Up to 300 messages, one model call each.">
          <Select label="How far back" value={days} options={DAYS} onChange={setDays} />
        </Field>
      </Form>
      <Onward
        next={{
          label: 'Pull in mail',
          busy,
          onPress: () =>
            run(async () => {
              await api.backfill(Number(days));
              toast(`Pulling in the last ${plural(Number(days), 'day')}`);
              onDone();
            }),
        }}
        back={{ label: 'New mail only', onPress: onDone }}
        error={error}
      />
    </Onboarding>
  );
}

/** How a step ends: the one thing to press, at most one other way, and what is happening or went wrong. */
function Onward({
  next,
  back,
  error,
  waiting = null,
}: {
  next: Next;
  back?: { label: string; onPress: () => void };
  error: string | null;
  waiting?: string | null;
}) {
  const disabled = next.disabled ?? false;
  // A link while it can be followed; a disabled button until then, since a link cannot be disabled.
  const link = next.href !== undefined && !disabled ? { href: next.href, target: '_blank', rel: 'noreferrer' } : { disabled };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-3 pt-2">
      <Button variant="mark" size="lg" busy={next.busy ?? false} onClick={next.onPress} {...link}>
        {next.label}
        {next.href ? <ArrowUpRightIcon aria-hidden /> : <ArrowRightIcon aria-hidden />}
      </Button>
      {back ? (
        <Button variant="quiet" size="lg" onClick={back.onPress}>
          {back.label}
        </Button>
      ) : null}
      {waiting ? <span className="text-sm text-muted-foreground">{waiting}</span> : null}
      <Failure>{error}</Failure>
    </div>
  );
}
