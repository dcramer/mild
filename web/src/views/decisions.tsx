import { useEffect, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { DecisionTable } from '@/components/decision-table.tsx';
import { type Days, api, useLoaded } from '@/lib/api.ts';
import { DISPOSITION_KEYS, TIERS, count, dispositionName } from '@/lib/format.ts';
import { useParam } from '@/lib/route.ts';
import { Button, Empty, FilterGroup, ListView, Loading } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const PAGE = 50;
const TIER_OPTIONS = [['', 'Any'], ...TIERS.map((t) => [t.key, t.name] as const)] as const;
const OUTCOME_OPTIONS = [['', 'Any'], ...DISPOSITION_KEYS.map((k) => [k, dispositionName(k)] as const)] as const;
export const PERIODS = [
  ['1', 'Last 24 hours'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
] as const;

/** Every decision sift made, newest first. */
export function Decisions({ days, onDays, onOpen }: { days: Days; onDays: (days: Days) => void; onOpen: OpenMessages }) {
  const [stage, setStage] = useParam('by', TIER_OPTIONS);
  const [disposition, setDisposition] = useParam('outcome', OUTCOME_OPTIONS);
  const [search, setSearch] = useParam('q');
  const [typed, setTyped] = useState(search);
  const [offset, setOffset] = useState(0);

  // Search as the viewer types, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => setOffset(0), [days, stage, disposition, search]);

  const query = { days, stage, disposition, search, limit: PAGE, offset };
  const { data, error, loading } = useLoaded(`decisions-${JSON.stringify(query)}`, (signal) => api.decisions(query, signal));
  const filtered = stage !== '' || disposition !== '' || search !== '';
  const period = PERIODS.find(([key]) => Number(key) === days)?.[1] ?? '';

  return (
    <ListView
      title="Decisions"
      count={data ? `${count(data.total)} in the ${period.toLowerCase()}` : null}
      search={{ value: typed, onChange: setTyped, placeholder: 'Search subject or sender' }}
      filters={{
        active: [
          ...(stage === '' ? [] : [{ label: `Decided by: ${TIER_OPTIONS.find(([key]) => key === stage)?.[1]}`, clear: () => setStage('') }]),
          ...(disposition === '' ? [] : [{ label: `Outcome: ${dispositionName(disposition)}`, clear: () => setDisposition('') }]),
          ...(days === 7 ? [] : [{ label: period, clear: () => onDays(7) }]),
        ],
        panel: (
          <>
            <FilterGroup
              label="Period"
              value={String(days) as (typeof PERIODS)[number][0]}
              options={PERIODS}
              onChange={(value) => onDays(Number(value) as Days)}
            />
            <FilterGroup label="Outcome" value={disposition} options={OUTCOME_OPTIONS} onChange={setDisposition} />
            <FilterGroup label="Decided by" value={stage} options={TIER_OPTIONS} onChange={setStage} />
          </>
        ),
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      <div>
        {loading ? (
          <Loading rows={8} />
        ) : !data || data.rows.length === 0 ? (
          <Empty>{filtered ? 'No decisions match.' : 'No decisions in this period.'}</Empty>
        ) : (
          <DecisionTable rows={data.rows} onOpen={onOpen} search={search} />
        )}
      </div>
      {data && data.total > PAGE ? (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground tabular-nums">
          <span>
            {count(offset + 1)}–{count(Math.min(offset + PAGE, data.total))} of {count(data.total)}
          </span>
          <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Newer
          </Button>
          <Button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            Older
          </Button>
        </div>
      ) : null}
    </ListView>
  );
}
