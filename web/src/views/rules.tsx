import { ArrowRightIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type RuleMatch, type RuleSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { AddRuleDialog } from '@/views/rule-dialog.tsx';
import { ago, count, describeMatch, factAnswers, factWords, outcomeName, plural, shortDate } from '@/lib/format.ts';
import {
  Blank,
  Button,
  ConfirmButton,
  Does,
  Empty,
  Fact,
  Facts,
  Failure,
  FilterGroup,
  ListView,
  Loading,
  Panel,
  RowActions,
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
  ['correction', 'You, correcting Sift'],
  ['learned', 'Sift, by blocking'],
] as const;

const MADE_BY: Record<string, string> = { user: 'You', correction: 'Your answers', learned: 'Sift, when it blocked them' };
const QUIET: Record<string, string> = { fromDomain: 'anyone at', to: 'sent to', listId: 'the list', subjectContains: 'subject has' };

/** What a rule matches: an address alone, or a quiet word and the value; then what the mail must be, in words. */
function Who({ match: { facts, ...match } }: { match: RuleMatch }) {
  const named = Object.entries(match);
  const asked = factAnswers(facts).map(factWords);
  return (
    <span className="name">
      {named.map(([key, value], index) => (
        <span key={key}>
          {index > 0 ? <span className="font-normal text-muted-foreground">, </span> : null}
          {QUIET[key] ? <span className="font-normal text-muted-foreground">{QUIET[key]} </span> : null}
          {key === 'subjectContains' ? `“${value}”` : value}
        </span>
      ))}
      {asked.length > 0 ? (
        <span className="font-normal">
          <span className="text-muted-foreground">{named.length > 0 ? ', that ' : 'mail that '}</span>
          {asked.join(' and ')}
        </span>
      ) : null}
    </span>
  );
}

function whoText({ facts, ...match }: RuleMatch): string {
  const named = Object.entries(match).map(([key, value]) => `${QUIET[key] ? `${QUIET[key]} ` : ''}${key === 'subjectContains' ? `“${value}”` : value}`);
  const asked = factAnswers(facts).map(factWords);
  return [...named, ...(asked.length > 0 ? [`${named.length > 0 ? 'that' : 'mail that'} ${asked.join(' and ')}`] : [])].join(', ');
}

/** The rule's own action: an action rule's, or an exception to its label's. */
const own = (rule: RuleSummary) => (rule.kind === 'label' ? rule.override : rule.disposition);

/** What the rule makes of the mail: its label, then an action only where the rule has its own. */
function Result({ rule }: { rule: RuleSummary }) {
  const action = own(rule);
  return (
    <>
      {rule.kind === 'label' ? <span>{rule.labelName}</span> : null}
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
          {rule.kind === 'action' ? null : <Fact term={rule.kind === 'when-label' ? 'When it is' : 'Is'}>{rule.labelName}</Fact>}
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
          {rule.kind === 'when-label' || rule.when ? <Fact term="Reading">Sift reads each message it matches.</Fact> : null}
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
  const accountId = manage.data?.accounts[0]?.id;
  const labels = accountId ? (manage.data?.labels[accountId] ?? []).map((l) => [l.id, l.name] as const) : [];
  const needle = search.trim().toLowerCase();
  const rules = (data?.rules ?? [])
    .filter(
      (r) =>
        (label === '' || r.labelId === label || r.whenLabel === label) &&
        (source === '' || r.source === source) &&
        (needle === '' || [whoText(r.match), r.labelName ?? ''].some((text) => text.toLowerCase().includes(needle))),
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
            toast(`Rule removed: ${describeMatch(rule.match)}`);
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
        <Loading>
          <Td className="max-w-0 md:w-full">
            <Blank />
          </Td>
          <Td phone="hide" num className="md:w-44">
            <Blank word />
          </Td>
        </Loading>
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
      {adding && accountId ? (
        <AddRuleDialog accountId={accountId} labels={manage.data?.labels[accountId] ?? []} onClose={() => setAdding(false)} onAdded={reload} />
      ) : null}
    </ListView>
  );
}
