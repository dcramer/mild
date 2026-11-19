'use client';
import { ArrowRightIcon, FunnelIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { type RuleSummary, api, useLoaded } from '@/lib/api.ts';
import { setParams, useParam } from '@/lib/params.ts';
import { filterStanding } from '@/views/gmail-filter.tsx';
import { RuleDialog } from '@/views/rule-dialog.tsx';
import { RemoveRule, RulePanel, Who, checked, homeOf, whoText } from '@/views/rule-panel.tsx';
import { useOpenMessages } from '@/lib/open-messages.ts';
import { INBOX, MADE_BY, count, dateTime, doesName, inboxFirst, outcomeName, plural } from '@/lib/format.ts';
import { Ago, Heads, Button, Does, Empty, FilterGroup, Hint, ListView, RowActions, Sub, Table, Td, Th, Tr } from '@/system';
import { usePlan } from '@/components/model-connect.tsx';
import { approx, atApiPrices } from '@/lib/prices.ts';
import { reveal } from '@/lib/reveal.ts';

const SOURCES = [['', 'Anyone'] as const, ...MADE_BY];

const GMAIL = [
  ['', 'Any'],
  ['filter', 'Is a filter'],
  ['could', 'Could be one'],
  ['cannot', 'Cannot be one'],
] as const;

/** A funnel where Gmail runs the rule as a filter. */
function FilterMark({ rule }: { rule: RuleSummary }) {
  if (filterStanding(rule) !== 'filter') return null;
  return (
    <span className="ml-2 inline-flex align-[-0.1em]">
      <Hint icon={FunnelIcon} says="Gmail filter" />
    </span>
  );
}

/** The rule's own action: an action rule's, or an exception to its label's. */
const own = (rule: RuleSummary) => (rule.kind === 'label' ? rule.override : rule.disposition);

/** What the rule makes of the mail: its label, then an action only where the rule has its own. */
function Result({ rule }: { rule: RuleSummary }) {
  // Leave in inbox says what happens itself.
  const action = rule.labelId === INBOX ? undefined : own(rule);
  return (
    <>
      {rule.kind === 'label' ? <span>{rule.labelName}</span> : null}
      {rule.kind === 'label' && action ? <span className="text-muted-foreground"> · </span> : null}
      {action ? <Does action={action}>{rule.kind === 'label' ? outcomeName(action) : doesName(null, action)}</Does> : null}
    </>
  );
}

/** Rules' own action: adding one, shown from the start and pressable once the account is known, so it does not arrive late and move the page. */
export function AddRule() {
  const manage = useLoaded('rule-accounts', (signal) => api.manage(signal), 60_000);
  const rules = useLoaded('rules', (signal) => api.rules(signal));
  const [adding, setAdding] = useState(false);
  const home = homeOf(manage.data);
  return (
    <>
      {/* Shown from the start and enabled once the account is known, so it does not arrive late and move the page. */}
      <Button disabled={!home} onClick={() => setAdding(true)}>
        <PlusIcon aria-hidden />
        Add a rule
      </Button>
      {adding && home ? <RuleDialog accountId={home} labels={manage.data?.labels ?? []} onClose={() => setAdding(false)} onAdded={rules.reload} /> : null}
    </>
  );
}

/** Everything sift knows without asking a model: the user's rules and the ones it learned. `loading` stands in for the rows until they come. */
export function Rules({ loading: loadingRows }: { loading: ReactNode }) {
  const onOpen = useOpenMessages();
  const plan = usePlan();
  const { data, error, loading } = useLoaded('rules', (signal) => api.rules(signal));
  const manage = useLoaded('rule-accounts', (signal) => api.manage(signal), 60_000);
  const [search, setSearch] = useParam('q');
  const [label, setLabel] = useParam('label');
  const [source, setSource] = useParam('by', SOURCES);
  const [gmail, setGmail] = useParam('gmail', GMAIL);
  const [open, setOpen] = useParam('rule');
  const home = homeOf(manage.data);
  const labels = (manage.data?.labels ?? []).map((l) => [l.id, l.name] as const);
  const needle = search.trim().toLowerCase();
  const rules = (data?.rules ?? [])
    .filter(
      (r) =>
        // A rule that only keeps leaves mail in the inbox as Leave in inbox does.
        (label === '' || r.labelId === label || r.whenLabel === label || (label === INBOX && r.labelId === null && r.disposition === 'keep')) &&
        (source === '' || r.source === source) &&
        (gmail === '' || (gmail === 'filter' ? r.filterId !== null : filterStanding(r) === gmail)) &&
        (needle === '' || [r.name ?? '', whoText(reveal(r.match)), r.labelName ?? ''].some((text) => reveal(text).toLowerCase().includes(needle))),
    )
    .toSorted((a, b) => b.hits - a.hits);
  const at = rules.findIndex((r) => r.id === open);
  const costs = (data?.rules ?? []).some(checked);

  return (
    <ListView
      search={{ value: search, onChange: setSearch, placeholder: 'Search senders, domains and labels' }}
      filters={{
        active: [
          ...(label === '' ? [] : [{ label: `Label: ${labels.find(([id]) => id === label)?.[1] ?? label}`, clear: () => setLabel('') }]),
          ...(source === '' ? [] : [{ label: `Made by: ${SOURCES.find(([key]) => key === source)?.[1]}`, clear: () => setSource('') }]),
          ...(gmail === '' ? [] : [{ label: `Gmail filter: ${GMAIL.find(([key]) => key === gmail)?.[1]}`, clear: () => setGmail('') }]),
        ],
        panel: (
          <>
            <FilterGroup label="Label" value={label} options={[['', 'Any'] as const, null, ...inboxFirst(labels)]} onChange={setLabel} />
            <FilterGroup label="Made by" value={source} options={SOURCES} onChange={setSource} />
            <FilterGroup label="Gmail filter" value={gmail} options={GMAIL} onChange={setGmail} />
          </>
        ),
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        loadingRows
      ) : rules.length === 0 ? (
        <Empty>{data && data.rules.length > 0 ? 'No rule matches.' : 'No rules yet.'}</Empty>
      ) : (
        <Table>
          <Heads shown="wide">
            <Th>
              <span className="sr-only">Rule</span>
            </Th>
            <Th phone="hide" num says="Messages the rule has decided since it was made">
              Decisions
            </Th>
            <Th phone="hide" num>
              Last used
            </Th>
            {costs ? (
              <Th
                phone="hide"
                num
                says={`What the model cost checking a rule’s condition over the last 30 days, whether the mail met it or not.${plan ? ` ${atApiPrices(plan)}` : ''}`}
              >
                Cost 30D
              </Th>
            ) : null}
            <Th phone="hide">
              <span className="sr-only">Remove</span>
            </Th>
          </Heads>
          <tbody>
            {rules.map((rule) => (
              <Tr key={rule.id} onOpen={() => setOpen(rule.id)}>
                <Td className="max-w-0 md:w-full">
                  <span className="block break-words md:truncate">
                    {rule.name ? (
                      <span className="name">{reveal(rule.name)}</span>
                    ) : home ? (
                      <Who accountId={home} match={reveal(rule.match)} />
                    ) : (
                      <span className="name">{whoText(reveal(rule.match))}</span>
                    )}
                    {rule.kind === 'when-label' ? <span className="text-muted-foreground"> as {rule.labelName}</span> : null}
                    <ArrowRightIcon aria-label="is" className="mx-2 inline size-4 align-[-0.15em] text-muted-foreground" />
                    <Result rule={rule} />
                    <FilterMark rule={rule} />
                  </span>
                  {rule.when ? <Sub className="whitespace-normal">only when it is {rule.when}</Sub> : null}
                </Td>
                <Td phone="hide" num className="md:w-28">
                  {count(rule.hits)}
                </Td>
                <Td phone="hide" num quiet className="md:w-32" says={rule.lastHitAt ? dateTime(rule.lastHitAt) : null}>
                  {rule.lastHitAt ? <Ago at={rule.lastHitAt} /> : 'Never'}
                </Td>
                {costs ? (
                  <Td phone="hide" num className="md:w-28" says={checked(rule) ? `${plural(rule.checks, 'message')} checked` : null}>
                    {checked(rule) ? approx(rule.checkCost, plan) : null}
                  </Td>
                ) : null}
                <RowActions>
                  <RemoveRule rule={rule} icon={<Trash2Icon aria-hidden />} />
                </RowActions>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {at !== -1 && home ? (
        <RulePanel
          key={rules[at].id}
          rule={rules[at]}
          home={home}
          labels={manage.data?.labels ?? []}
          active={manage.data?.active ?? false}
          position={`${at + 1} of ${rules.length}`}
          onOpen={onOpen}
          onPrevious={at > 0 ? () => setOpen(rules[at - 1].id) : undefined}
          onNext={at < rules.length - 1 ? () => setOpen(rules[at + 1].id) : undefined}
          onClose={() => setParams({ rule: '', apply: '' })}
        />
      ) : null}
    </ListView>
  );
}
