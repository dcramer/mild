import { ArrowRightIcon, FunnelIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type RuleSummary, api, useAction, useLoaded } from '@/lib/api.ts';
import { setParams, useParam } from '@/lib/route.ts';
import { filterStanding, standingWords } from '@/views/gmail-filter.tsx';
import { AddRuleDialog } from '@/views/rule-dialog.tsx';
import { RulePanel, Who, whoText } from '@/views/rule-panel.tsx';
import { ago, count, describeMatch, outcomeName } from '@/lib/format.ts';
import {
  Blank,
  Button,
  ConfirmButton,
  Does,
  Empty,
  Failure,
  FilterGroup,
  Hint,
  ListView,
  TextLink,
  Loading,
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

const GMAIL = [
  ['', 'Any'],
  ['filter', 'Is a filter'],
  ['could', 'Could be one'],
  ['cannot', 'Cannot be one'],
  ['look', 'Needs a look'],
] as const;

/** A rule's standing as a Gmail filter as an icon, only where it is one or should have been. */
function FilterMark({ rule }: { rule: RuleSummary }) {
  const standing = filterStanding(rule);
  if (standing === 'could' || standing === 'cannot') return null;
  return (
    <span className="ml-2 inline-flex align-[-0.1em]">
      <Hint icon={FunnelIcon} says={standingWords(rule)} tone={standing === 'failed' ? 'failure' : standing === 'look' ? 'look' : 'plain'} />
    </span>
  );
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

/** Everything sift knows without asking a model: the user's rules and the ones it learned. */
export function Rules() {
  const { data, error, loading, reload } = useLoaded('rules', (signal) => api.rules(signal));
  const manage = useLoaded('rule-accounts', (signal) => api.manage(signal), 60_000);
  const remove = useAction();
  const toast = useToast();
  const [search, setSearch] = useParam('q');
  const [label, setLabel] = useParam('label');
  const [source, setSource] = useParam('by', SOURCES);
  const [gmail, setGmail] = useParam('gmail', GMAIL);
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
        (gmail === '' ||
          (gmail === 'filter'
            ? r.filterId !== null
            : gmail === 'look'
              ? ['failed', 'look'].includes(filterStanding(r))
              : !r.filterId && filterStanding(r) === gmail)) &&
        (needle === '' || [whoText(r.match), r.labelName ?? ''].some((text) => text.toLowerCase().includes(needle))),
    )
    .toSorted((a, b) => b.hits - a.hits);
  const at = rules.findIndex((r) => r.id === open);
  const failedFilters = (data?.rules ?? []).filter((r) => filterStanding(r) === 'failed').length;

  const removeButton = (rule: RuleSummary) => (
    <ConfirmButton
      question="Remove this rule?"
      variant="quiet"
      icon={<Trash2Icon aria-hidden />}
      disabled={remove.busy}
      onConfirm={() =>
        remove.run(
          () => api.removeRule(rule.id),
          () => toast(`Rule removed: ${describeMatch(rule.match)}`),
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
          ...(gmail === '' ? [] : [{ label: `In Gmail: ${GMAIL.find(([key]) => key === gmail)?.[1]}`, clear: () => setGmail('') }]),
        ],
        panel: (
          <>
            <FilterGroup label="Label" value={label} options={[['', 'Any'] as const, ...labels]} onChange={setLabel} />
            <FilterGroup label="Made by" value={source} options={SOURCES} onChange={setSource} />
            <FilterGroup label="In Gmail" value={gmail} options={GMAIL} onChange={setGmail} />
          </>
        ),
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      <Failure>{remove.error}</Failure>
      {failedFilters > 0 && gmail !== 'look' ? (
        <Failure>
          Gmail did not take the filter change for {failedFilters === 1 ? '1 rule' : `${count(failedFilters)} rules`}.{' '}
          <TextLink href="/rules?gmail=look">See {failedFilters === 1 ? 'it' : 'them'}</TextLink>
        </Failure>
      ) : null}
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
                    <FilterMark rule={rule} />
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
                <RowActions>{removeButton(rule)}</RowActions>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {at !== -1 ? (
        <RulePanel
          key={rules[at].id}
          rule={rules[at]}
          active={manage.data?.active ?? false}
          position={`${at + 1} of ${rules.length}`}
          onPrevious={at > 0 ? () => setOpen(rules[at - 1].id) : undefined}
          onNext={at < rules.length - 1 ? () => setOpen(rules[at + 1].id) : undefined}
          onClose={() => setParams({ rule: '', apply: '' })}
        />
      ) : null}
      {adding && accountId ? (
        <AddRuleDialog accountId={accountId} labels={manage.data?.labels[accountId] ?? []} onClose={() => setAdding(false)} onAdded={reload} />
      ) : null}
    </ListView>
  );
}
