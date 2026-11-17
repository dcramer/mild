import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { MailLog, MailLogLoading } from '@/components/mail-log.tsx';
import { type Days, type DecisionRow, api, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { FACT_FILTER_OPTIONS, HANDLED, PERIODS, count, inboxFirst, labelSeries, factFilterName, longDay, money, moneyTick, shortDay } from '@/lib/format.ts';
import { Button, Empty, FilterGroup, ListView, Reserve, Select, StackedBars, useToast } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';
import { usePlan } from '@/components/model-connect.tsx';
import { costName } from '@/lib/prices.ts';

const PAGE = 50;
/** What the list shows. Changed: what sift did, or tried to do, in Gmail. Everything adds suggestions and mail left alone. */
const VIEWS = [
  ['', 'Changed'],
  ['all', 'Everything'],
] as const;

/** What sift did to mail, by day, newest first, with a way to undo it. */
export function ActivityView({ onOpen }: { onOpen: OpenMessages }) {
  const plan = usePlan();
  const [chosen, setChosen] = useParam('days');
  const days = (PERIODS.some(([key]) => key === chosen) ? Number(chosen) : 7) as Days;
  const [view, setView] = useParam('show', VIEWS);
  const [search, setSearch] = useParam('q');
  const [fact, setFact] = useParam('fact', FACT_FILTER_OPTIONS);
  const [label, setLabel] = useParam('label');
  const [typed, setTyped] = useState(search);
  const [page, setPage] = useParam('page');
  const offset = (Math.max(1, Math.floor(Number(page)) || 1) - 1) * PAGE;
  const goTo = (at: number) => setPage(at === 0 ? '' : String(at / PAGE + 1));
  const client = useQueryClient();
  const toast = useToast();

  // Search as the viewer types, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  // A narrower list starts at its first page; a page in the address it was opened with stands.
  const narrowed = JSON.stringify([days, view, search, fact, label]);
  const shown = useRef(narrowed);
  useEffect(() => {
    if (shown.current === narrowed) return;
    shown.current = narrowed;
    goTo(0);
  }, [narrowed]);

  const status = view === '' ? 'changed' : '';
  const query = { days, status, search, fact, label, limit: PAGE, offset };
  const { data, error, loading } = useLoaded(`decisions-${JSON.stringify(query)}`, (signal) => api.decisions(query, signal));
  const manage = useLoaded('manage', (signal) => api.manage(signal), 60_000);
  // A label is one thing across the mailboxes, with the same id in each.
  const labels = new Map(Object.values(manage.data?.labels ?? {}).flatMap((list) => list.map((l) => [l.id, l.name] as const)));
  const summary = useLoaded(`summary-${days}-${label}`, (signal) => api.summary(days, signal, label));
  const daily = summary.data?.daily ?? [];
  // A day's column is worth drawing only beside others, and only once something happened.
  const charted = daily.length > 1 && daily.some((day) => day.costUsd > 0 || Object.values(day.counts).some((n) => n > 0));

  const undo = (row: DecisionRow) =>
    void api.undo(row.actionId ?? 0).then(
      ({ message }) => {
        if (message) toast(message);
        void client.invalidateQueries();
      },
      (failure: unknown) => toast('Could not undo', { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) }),
    );

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
        active: [
          ...(label === '' ? [] : [{ label: `Label: ${labels.get(label) ?? label}`, clear: () => setLabel('') }]),
          ...(fact === '' ? [] : [{ label: factFilterName(fact), clear: () => setFact('') }]),
        ],
        panel: (
          <>
            <FilterGroup label="Label" value={label} options={[['', 'Any'] as const, null, ...inboxFirst(labels)]} onChange={setLabel} />
            <FilterGroup label="What Sift saw" value={fact} options={FACT_FILTER_OPTIONS} onChange={setFact} />
          </>
        ),
      }}
      intro={
        // The chart arrives after the list is drawn, and would push it down.
        <Reserve id="activity-intro" ready={summary.data !== null} room={{ narrow: 200, wide: 200 }}>
          <div className="flex flex-col gap-6">
            {charted ? (
              <StackedBars
                series={label === '' ? HANDLED : labelSeries(labels.get(label) ?? label)}
                rows={daily.map((day) => {
                  const handled = Object.values(day.counts).reduce((a, b) => a + b, 0);
                  const changed = day.changes.archive + day.changes.spam + day.changes.keep;
                  const labelled = day.labelled ?? 0;
                  const values: Record<string, number> =
                    label === '' ? { changed, left: Math.max(0, handled - changed) } : { label: labelled, rest: Math.max(0, handled - labelled) };
                  return {
                    key: day.day,
                    label: shortDay(day.day),
                    title: longDay(day.day),
                    values,
                  };
                })}
                line={{ name: costName(plan), values: daily.map((day) => day.costUsd), format: money, tick: moneyTick }}
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
          {search !== '' || fact !== '' || label !== ''
            ? 'Nothing matches.'
            : view === ''
              ? 'Sift has changed nothing in Gmail in this period.'
              : 'Nothing in this period.'}
        </Empty>
      ) : (
        <MailLog rows={data.rows} onOpen={onOpen} onUndo={undo} search={search} labelled={label !== ''} />
      )}
      {data && data.total > PAGE ? (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground tabular-nums">
          <span>
            {count(offset + 1)}–{count(Math.min(offset + PAGE, data.total))} of {count(data.total)}
          </span>
          <Button disabled={offset === 0} onClick={() => goTo(Math.max(0, offset - PAGE))}>
            Newer
          </Button>
          <Button disabled={offset + PAGE >= data.total} onClick={() => goTo(offset + PAGE)}>
            Older
          </Button>
        </div>
      ) : null}
    </ListView>
  );
}
