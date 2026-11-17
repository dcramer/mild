import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { MailLog, MailLogLoading } from '@/components/mail-log.tsx';
import { type Days, type DecisionRow, api, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { FACT_FILTER_OPTIONS, HANDLED, PERIODS, count, factFilterName, longDay, money, moneyTick, shortDay } from '@/lib/format.ts';
import { Button, Empty, FilterGroup, ListView, Reserve, Select, StackedBars, useToast } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const PAGE = 50;
/** What the list shows. Changed: what sift did, or tried to do, in Gmail. Everything adds suggestions and mail left alone. */
const VIEWS = [
  ['', 'Changed'],
  ['all', 'Everything'],
] as const;

/** What sift did to mail, by day, newest first, with a way to undo it. */
export function ActivityView({ onOpen }: { onOpen: OpenMessages }) {
  const [chosen, setChosen] = useParam('days');
  const days = (PERIODS.some(([key]) => key === chosen) ? Number(chosen) : 7) as Days;
  const [view, setView] = useParam('show', VIEWS);
  const [search, setSearch] = useParam('q');
  const [fact, setFact] = useParam('fact', FACT_FILTER_OPTIONS);
  const [typed, setTyped] = useState(search);
  const [offset, setOffset] = useState(0);
  const client = useQueryClient();
  const toast = useToast();

  // Search as the viewer types, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => setOffset(0), [days, view, search, fact]);

  const status = view === '' ? 'changed' : '';
  const query = { days, stage: '', disposition: '', status, search, fact, limit: PAGE, offset };
  const { data, error, loading } = useLoaded(`decisions-${JSON.stringify(query)}`, (signal) => api.decisions(query, signal));
  const summary = useLoaded(`summary-${days}`, (signal) => api.summary(days, signal));
  const daily = summary.data?.daily ?? [];
  // A day's column is worth drawing only beside others, and only once something happened.
  const charted = daily.length > 1 && daily.some((day) => day.costUsd > 0 || Object.values(day.counts).some((n) => n > 0));

  // `line` is null when the list itself shows what happened.
  const report = <T,>(work: Promise<T>, line: (result: T) => string | null, failed: string) =>
    void work.then(
      (result) => {
        const said = line(result);
        if (said) toast(said);
        void client.invalidateQueries();
      },
      (failure: unknown) => toast(failed, { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) }),
    );
  const undo = (row: DecisionRow) => report(api.undo(row.actionId ?? 0), ({ message }) => message, 'Could not undo');

  return (
    <ListView
      title="Activity"
      actions={
        <Select
          label="Period"
          value={String(days) as (typeof PERIODS)[number][0]}
          options={PERIODS}
          onChange={(value) => setChosen(value === '7' ? '' : value)}
        />
      }
      search={{ value: typed, onChange: setTyped, placeholder: 'Search subject or sender' }}
      view={{
        label: 'Show',
        value: view,
        options: VIEWS,
        onChange: (next) => setView(next as typeof view),
      }}
      filters={{
        active: fact === '' ? [] : [{ label: factFilterName(fact), clear: () => setFact('') }],
        panel: <FilterGroup label="What Sift saw" value={fact} options={FACT_FILTER_OPTIONS} onChange={setFact} />,
      }}
      intro={
        // The chart arrives after the list is drawn, and would push it down.
        <Reserve id="activity-intro" ready={summary.data !== null} room={{ narrow: 200, wide: 200 }}>
          <div className="flex flex-col gap-6">
            {charted ? (
              <StackedBars
                series={HANDLED}
                rows={daily.map((day) => {
                  const handled = Object.values(day.counts).reduce((a, b) => a + b, 0);
                  const changed = day.changes.archive + day.changes.spam + day.changes.keep;
                  return {
                    key: day.day,
                    label: shortDay(day.day),
                    title: longDay(day.day),
                    values: { changed, left: Math.max(0, handled - changed) },
                  };
                })}
                line={{ name: 'Model cost', values: daily.map((day) => day.costUsd), format: money, tick: moneyTick }}
              />
            ) : null}
          </div>
        </Reserve>
      }
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <MailLogLoading />
      ) : !data || data.rows.length === 0 ? (
        <Empty>
          {search !== '' || fact !== '' ? 'Nothing matches.' : view === '' ? 'Sift has changed nothing in Gmail in this period.' : 'Nothing in this period.'}
        </Empty>
      ) : (
        <MailLog rows={data.rows} onOpen={onOpen} onUndo={undo} search={search} />
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
