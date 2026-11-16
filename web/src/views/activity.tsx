import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { DecisionTable } from '@/components/decision-table.tsx';
import { type Days, api, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { OUTCOME_KEYS, PERIODS, STATUS_FILTERS, TIERS, count, outcomeName, plural } from '@/lib/format.ts';
import { Button, Empty, FilterGroup, ListView, Loading, useToast } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const PAGE = 50;
const TIER_OPTIONS = [['', 'Any'], ...TIERS.map((t) => [t.key, t.name] as const)] as const;
const OUTCOME_OPTIONS = [['', 'Any'], ...OUTCOME_KEYS.map((k) => [k, outcomeName(k)] as const)] as const;

/** Everything sift decided, newest first, with where each got to in Gmail and a way to undo what it changed. */
export function ActivityView({ onOpen }: { onOpen: OpenMessages }) {
  const [chosen, setChosen] = useParam('days');
  const days = (PERIODS.some(([key]) => key === chosen) ? Number(chosen) : 7) as Days;
  const setDays = (next: Days) => setChosen(next === 7 ? '' : String(next));
  const [status, setStatus] = useParam('status', STATUS_FILTERS);
  const [stage, setStage] = useParam('by', TIER_OPTIONS);
  const [disposition, setDisposition] = useParam('outcome', OUTCOME_OPTIONS);
  const [search, setSearch] = useParam('q');
  const [typed, setTyped] = useState(search);
  const [offset, setOffset] = useState(0);
  const client = useQueryClient();
  const toast = useToast();

  // Search as the viewer types, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => setOffset(0), [days, status, stage, disposition, search]);

  const query = { days, stage, disposition, status, search, limit: PAGE, offset };
  const { data, error, loading } = useLoaded(`decisions-${JSON.stringify(query)}`, (signal) => api.decisions(query, signal));
  const filtered = stage !== '' || disposition !== '' || status !== '' || search !== '';
  const period = PERIODS.find(([key]) => Number(key) === days)?.[1] ?? '';
  const name = (options: readonly (readonly [string, string])[], key: string) => options.find(([k]) => k === key)?.[1] ?? key;

  return (
    <ListView
      title="Activity"
      meta={data ? `${plural(data.total, 'decision')}, ${period.toLowerCase()}` : null}
      search={{ value: typed, onChange: setTyped, placeholder: 'Search subject or sender' }}
      filters={{
        active: [
          ...(status === '' ? [] : [{ label: `Status: ${name(STATUS_FILTERS, status)}`, clear: () => setStatus('') }]),
          ...(disposition === '' ? [] : [{ label: `Then: ${outcomeName(disposition)}`, clear: () => setDisposition('') }]),
          ...(stage === '' ? [] : [{ label: `Decided by: ${name(TIER_OPTIONS, stage)}`, clear: () => setStage('') }]),
          ...(days === 7 ? [] : [{ label: period, clear: () => setDays(7) }]),
        ],
        panel: (
          <>
            <FilterGroup
              label="Period"
              value={String(days) as (typeof PERIODS)[number][0]}
              options={PERIODS}
              onChange={(value) => setDays(Number(value) as Days)}
            />
            <FilterGroup label="Status" value={status} options={STATUS_FILTERS} onChange={setStatus} />
            <FilterGroup label="Then" value={disposition} options={OUTCOME_OPTIONS} onChange={setDisposition} />
            <FilterGroup label="Decided by" value={stage} options={TIER_OPTIONS} onChange={setStage} />
          </>
        ),
      }}
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Loading rows={8} />
      ) : !data || data.rows.length === 0 ? (
        <Empty>
          {filtered
            ? 'Nothing matches.'
            : 'Nothing decided in this period. sift records a decision for every message it sorts, including the ones it leaves alone.'}
        </Empty>
      ) : (
        <DecisionTable
          rows={data.rows}
          onOpen={onOpen}
          search={search}
          onUndo={(row) =>
            void api.undo(row.actionId ?? 0).then(
              ({ message }) => {
                toast(message);
                void client.invalidateQueries();
              },
              (failure: unknown) => toast('Could not undo', { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) }),
            )
          }
        />
      )}
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
