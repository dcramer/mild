import { ArrowRightIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type RuleSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { ago, count, outcomeName, plural, shortDate } from '@/lib/format.ts';
import {
  Button,
  Check,
  ConfirmButton,
  Dialog,
  Does,
  Empty,
  Fact,
  Facts,
  Failure,
  Field,
  FilterGroup,
  Form,
  Input,
  ListView,
  Loading,
  Panel,
  RowActions,
  Select,
  Sub,
  Table,
  Td,
  Th,
  Tr,
  useToast,
} from '@/system';

const SOURCES = [
  ['', 'Anyone'],
  ['user', 'You'],
  ['correction', 'You, correcting sift'],
  ['agent', 'sift, by blocking'],
] as const;

const WHEN = [
  ['from', 'From the address'],
  ['fromDomain', 'From anyone at'],
  ['listId', 'On the list'],
  ['to', 'Sent to'],
  ['subjectContains', 'Subject contains'],
] as const;
const KINDS = [
  ['action', 'Always do this to it'],
  ['label', 'It is always this label'],
  ['when-label', 'When sift says it is this label'],
] as const;
type Kind = (typeof KINDS)[number][0];
const DOES = [
  ['keep', 'Keep it'],
  ['archive', 'Archive it'],
  ['spam', 'Spam it'],
] as const;
const AS_LABEL = ['', 'As the label says'] as const;
type Does = '' | (typeof DOES)[number][0];
const READING: Record<Kind, string> = {
  action: 'No model reads this mail, and sift does not say what it is.',
  label: 'No model reads this mail.',
  'when-label': 'sift still reads each message. Mail from here that is something else is judged as usual.',
};

function AddRuleDialog({
  accountId,
  labels,
  from,
  onClose,
  onAdded,
}: {
  accountId: string;
  labels: readonly (readonly [string, string])[];
  /** A sender to start from, when the dialog was opened from one of their messages. */
  from?: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { busy, error, run } = useAction();
  const [when, setWhen] = useState<(typeof WHEN)[number][0]>('from');
  const [value, setValue] = useState(from ?? '');
  const [kind, setKind] = useState<Kind>('action');
  const [label, setLabel] = useState('');
  const [does, setDoes] = useState<Does>('archive');
  const [markRead, setMarkRead] = useState(false);
  const [unsubscribe, setUnsubscribe] = useState(false);
  const [condition, setCondition] = useState('');
  // An action rule has no label to take its action from.
  const action = kind === 'action' && does === '' ? 'archive' : does;
  const ready = value.trim() !== '' && (kind === 'action' || label !== '');
  const add = () =>
    run(
      () =>
        api.addRule({
          accountId,
          match: { [when]: value.trim() },
          ...(kind === 'label' ? { label } : kind === 'when-label' ? { whenLabel: label } : {}),
          ...(action === '' ? {} : { disposition: action }),
          ...(markRead ? { markRead } : {}),
          ...(unsubscribe ? { unsubscribe } : {}),
          ...(kind === 'label' && condition.trim() !== '' ? { when: condition.trim() } : {}),
        }),
      () => {
        onAdded();
        onClose();
      },
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a rule"
      footer={
        <>
          <Button variant="ink" busy={busy} disabled={!ready} onClick={add}>
            Add rule
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      <Form onSubmit={() => ready && add()}>
        <Field label="Mail">
          <Select label="Condition" value={when} options={WHEN} onChange={setWhen} />
          <Input
            autoFocus
            className="min-w-48 flex-1"
            aria-label="Value to match"
            placeholder={when === 'fromDomain' ? 'example.com' : when === 'from' ? 'name@example.com' : ''}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Field label="Then" hint={READING[kind]}>
          <Select label="What the rule says" value={kind} options={KINDS} onChange={setKind} />
          {kind === 'action' ? null : <Select label="Label" value={label} options={[['', 'Choose a label'] as const, ...labels]} onChange={setLabel} />}
          <Select label="What sift does" value={action} options={kind === 'action' ? DOES : [AS_LABEL, ...DOES]} onChange={setDoes} />
        </Field>
        {kind === 'label' ? (
          <Field label="Only when it is (optional)" hint="In your words. Only a model can apply this, so sift reads each message the rule matches.">
            <Input
              aria-label="What the mail must be, in your words"
              className="w-full"
              placeholder="a notice for a lot I did not bid on"
              value={condition}
              onChange={(event) => setCondition(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Also">
          <div className="flex flex-col gap-2">
            <Check checked={markRead} onChange={setMarkRead}>
              Mark it read
            </Check>
            <Check checked={unsubscribe} onChange={setUnsubscribe}>
              Unsubscribe, when the sender offers a safe way
            </Check>
          </div>
        </Field>
      </Form>
    </Dialog>
  );
}

const MADE_BY: Record<string, string> = { user: 'You', correction: 'Your answers', agent: 'sift, when it blocked them' };
const QUIET: Record<string, string> = { fromDomain: 'anyone at', to: 'sent to', listId: 'the list', subjectContains: 'subject has' };

/** What a rule matches: an address alone, or a quiet word and the value. */
function Who({ match }: { match: Record<string, string> }) {
  return (
    <span className="name">
      {Object.entries(match).map(([key, value], index) => (
        <span key={key}>
          {index > 0 ? <span className="font-normal text-muted-foreground">, </span> : null}
          {QUIET[key] ? <span className="font-normal text-muted-foreground">{QUIET[key]} </span> : null}
          {key === 'subjectContains' ? `“${value}”` : value}
        </span>
      ))}
    </span>
  );
}

const whoText = (match: Record<string, string>) =>
  Object.entries(match)
    .map(([key, value]) => `${QUIET[key] ? `${QUIET[key]} ` : ''}${key === 'subjectContains' ? `“${value}”` : value}`)
    .join(', ');

/** The rule's own action: an action rule's, or an exception to its label's. */
const own = (rule: RuleSummary) => (rule.kind === 'label' ? rule.override : rule.disposition);

/** What the rule makes of the mail: its label, then an action only where the rule has its own. */
function Result({ rule }: { rule: RuleSummary }) {
  const action = own(rule);
  return (
    <>
      {rule.labelGone ? <Failure inline>A removed label</Failure> : rule.kind === 'label' ? <span>{rule.labelName}</span> : null}
      {rule.kind === 'label' && action ? <span className="text-muted-foreground"> · </span> : null}
      {action ? <Does action={action}>{outcomeName(action)}</Does> : null}
    </>
  );
}

function RulePanel({
  rule,
  position,
  onPrevious,
  onNext,
  onClose,
  remove,
}: {
  rule: RuleSummary;
  position: string;
  onPrevious: (() => void) | undefined;
  onNext: (() => void) | undefined;
  onClose: () => void;
  remove: ReactNode;
}) {
  const action = rule.disposition;
  return (
    <Panel open onClose={onClose} title={whoText(rule.match)} position={position} onPrevious={onPrevious} onNext={onNext}>
      <div className="flex flex-col gap-8">
        <Facts>
          {rule.kind === 'action' ? null : (
            <Fact term={rule.kind === 'when-label' ? 'When it is' : 'Is'}>{rule.labelGone ? <Failure inline>A removed label</Failure> : rule.labelName}</Fact>
          )}
          {action ? (
            <Fact term="Then">
              <Does action={action}>{outcomeName(action)}</Does>
              {rule.override && rule.kind === 'label' ? <span className="text-muted-foreground"> instead of the label’s</span> : null}
              {[rule.markRead ? 'marked read' : null, rule.unsubscribe ? 'unsubscribed' : null].filter(Boolean).map((extra) => (
                <span key={extra} className="text-muted-foreground">
                  , {extra}
                </span>
              ))}
            </Fact>
          ) : null}
          {rule.when ? <Fact term="Only when it is">{rule.when}</Fact> : null}
          {rule.except.length > 0 ? (
            <Fact term="Unless">
              {rule.except.map((except, index) => (
                <span key={index} className="block">
                  <Who match={except} />
                </span>
              ))}
            </Fact>
          ) : null}
          {rule.kind === 'when-label' || rule.when ? <Fact term="Reading">sift reads each message it matches.</Fact> : null}
          <Fact term="Used">{rule.hits === 0 ? 'Never' : `${plural(rule.hits, 'time')}${rule.lastHitAt ? `, last ${ago(rule.lastHitAt)}` : ''}`}</Fact>
          <Fact term="Made by">
            {MADE_BY[rule.source] ?? rule.source}, {shortDate(rule.createdAt)}
          </Fact>
          {rule.filterId ? <Fact term="In Gmail">A filter does this too.</Fact> : null}
        </Facts>
        <div>{remove}</div>
      </div>
    </Panel>
  );
}

/** Everything sift knows without asking a model: the user's rules and the ones it learned. */
export function Rules() {
  const { data, error, loading, reload } = useLoaded('rules', (signal) => api.rules(signal));
  const manage = useLoaded('rule-accounts', (signal) => api.manage(signal), 60_000);
  const remove = useAction();
  const toast = useToast();
  const [search, setSearch] = useParam('q');
  const [label, setLabel] = useParam('label');
  const [source, setSource] = useParam('by', SOURCES);
  const [open, setOpen] = useParam('rule');
  const [adding, setAdding] = useState(false);
  // Opened from a message ("Make a rule…"): the dialog starts on its sender.
  const [from, setFrom] = useParam('from');
  const accountId = manage.data?.accounts[0]?.id;
  const labels = accountId ? (manage.data?.labels[accountId] ?? []).map((l) => [l.id, l.name] as const) : [];
  const needle = search.trim().toLowerCase();
  const rules = (data?.rules ?? [])
    .filter(
      (r) =>
        (label === '' || r.labelId === label || r.whenLabel === label) &&
        (source === '' || r.source === source) &&
        (needle === '' || [...Object.values(r.match), r.labelName ?? ''].some((text) => text.toLowerCase().includes(needle))),
    )
    .toSorted((a, b) => b.hits - a.hits);
  const at = rules.findIndex((r) => r.id === open);
  const removeButton = (rule: RuleSummary, inPanel: boolean) => (
    <ConfirmButton
      question="Remove this rule?"
      variant={inPanel ? 'plain' : 'quiet'}
      {...(inPanel ? {} : { icon: <Trash2Icon aria-hidden /> })}
      disabled={remove.busy}
      onConfirm={() =>
        remove.run(
          () => api.removeRule(rule.id),
          () => {
            toast(`Removed the rule for ${whoText(rule.match)}.`);
            if (inPanel) setOpen('');
            reload();
          },
        )
      }
    >
      Remove
    </ConfirmButton>
  );

  return (
    <ListView
      title="Rules"
      actions={
        // Shown from the start and enabled once the account is known, so it does not arrive late and move the page.
        <Button disabled={!accountId} onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden />
          Add a rule
        </Button>
      }
      search={{ value: search, onChange: setSearch, placeholder: 'Search senders, domains and labels' }}
      filters={{
        active: [
          ...(label === '' ? [] : [{ label: `Label: ${labels.find(([id]) => id === label)?.[1] ?? label}`, clear: () => setLabel('') }]),
          ...(source === '' ? [] : [{ label: `Made by: ${SOURCES.find(([key]) => key === source)?.[1]}`, clear: () => setSource('') }]),
        ],
        panel: (
          <>
            <FilterGroup label="Label" value={label} options={[['', 'Any'] as const, ...labels]} onChange={setLabel} />
            <FilterGroup label="Made by" value={source} options={SOURCES} onChange={setSource} />
          </>
        ),
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      <Failure>{remove.error}</Failure>
      {loading ? (
        <Loading />
      ) : rules.length === 0 ? (
        <Empty>{data && data.rules.length > 0 ? 'No rule matches.' : 'No rules yet.'}</Empty>
      ) : (
        <Table>
          <thead className="sr-only">
            <Tr>
              <Th>Rule</Th>
              <Th phone="hide">Used</Th>
              <Th phone="hide">Remove</Th>
            </Tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <Tr key={rule.id} onOpen={() => setOpen(rule.id)}>
                <Td className="max-w-0 md:w-full">
                  <span className="block break-words md:truncate">
                    <Who match={rule.match} />
                    {rule.kind === 'when-label' ? <span className="text-muted-foreground"> as {rule.labelName}</span> : null}
                    <ArrowRightIcon aria-label="is" className="mx-2 inline size-4 align-[-0.15em] text-muted-foreground" />
                    <Result rule={rule} />
                  </span>
                  {rule.when ? <Sub className="whitespace-normal">only when it is {rule.when}</Sub> : null}
                </Td>
                <Td phone="hide" num quiet className="md:w-44">
                  {rule.hits === 0 ? (
                    'Never used'
                  ) : (
                    <>
                      <span className="text-foreground">{count(rule.hits)}</span>
                      {rule.lastHitAt ? ` · ${ago(rule.lastHitAt)}` : null}
                    </>
                  )}
                </Td>
                <RowActions>{removeButton(rule, false)}</RowActions>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {at !== -1 ? (
        <RulePanel
          key={rules[at].id}
          rule={rules[at]}
          position={`${at + 1} of ${rules.length}`}
          onPrevious={at > 0 ? () => setOpen(rules[at - 1].id) : undefined}
          onNext={at < rules.length - 1 ? () => setOpen(rules[at + 1].id) : undefined}
          onClose={() => setOpen('')}
          remove={removeButton(rules[at], true)}
        />
      ) : null}
      {(adding || from !== '') && accountId ? (
        <AddRuleDialog
          accountId={accountId}
          labels={labels}
          {...(from === '' ? {} : { from })}
          onClose={() => {
            setAdding(false);
            setFrom('');
          }}
          onAdded={reload}
        />
      ) : null}
    </ListView>
  );
}
