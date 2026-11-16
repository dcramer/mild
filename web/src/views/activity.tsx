import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { MailLog } from '@/components/mail-log.tsx';
import { type Days, type DecisionRow, api, useLoaded } from '@/lib/api.ts';
import { useParam } from '@/lib/route.ts';
import { HANDLED, PERIODS, count, longDay, money, moneyTick, plural, shortDay } from '@/lib/format.ts';
import { Button, Empty, Failure, ListView, Loading, Select, StackedBars, TextLink, useToast } from '@/system';
import type { OpenMessages } from '@/views/message-panel.tsx';

const PAGE = 50;
/** What the list shows. Changed: what sift did, or tried to do, in Gmail. Everything adds suggestions and mail left alone. */
const VIEWS = [
  ['', 'Changed'],
  ['all', 'Everything'],
] as const;
const FAILED = [['trouble', 'Failed'] as const];

/** What sift did to mail, by day, newest first, with a way to undo it or try a failed change again. */
export function ActivityView({ onOpen }: { onOpen: OpenMessages }) {
  const [chosen, setChosen] = useParam('days');
  const days = (PERIODS.some(([key]) => key === chosen) ? Number(chosen) : 7) as Days;
  const [view, setView] = useParam('show', [...VIEWS, ...FAILED]);
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
  useEffect(() => setOffset(0), [days, view, search]);

  const status = view === '' ? 'changed' : view === 'trouble' ? 'trouble' : '';
  const query = { days, stage: '', disposition: '', status, search, limit: PAGE, offset };
  const { data, error, loading } = useLoaded(`decisions-${JSON.stringify(query)}`, (signal) => api.decisions(query, signal));
  const failures = useLoaded(`decisions-trouble-${days}`, (signal) =>
    api.decisions({ days, stage: '', disposition: '', status: 'trouble', search: '', limit: 1, offset: 0 }, signal),
  );
  const failed = failures.data?.total ?? 0;
  const summary = useLoaded(`summary-${days}`, (signal) => api.summary(days, signal));
  const daily = summary.data?.daily ?? [];
  // A day's column is worth drawing only beside others, and only once something happened.
  const charted = daily.length > 1 && daily.some((day) => day.costUsd > 0 || Object.values(day.counts).some((n) => n > 0));

  const report = <T,>(work: Promise<T>, line: (result: T) => string) =>
    void work.then(
      (result) => {
        toast(line(result));
        void client.invalidateQueries();
      },
      (failure: unknown) => toast('That did not work', { tone: 'failure', description: failure instanceof Error ? failure.message : String(failure) }),
    );
  const undo = (row: DecisionRow) => report(api.undo(row.actionId ?? 0), ({ message }) => message);
  const retry = (row: DecisionRow) =>
    report(api.retry(row.id), ({ waiting }) => (waiting ? 'It will be tried again once sift is acting.' : 'Trying again now.'));

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
        options: view === 'trouble' || failed > 0 ? [...VIEWS, ...FAILED] : VIEWS,
        onChange: (next) => setView(next as typeof view),
      }}
      intro={
        <>
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
                  values: { changed, left: Math.max(0, handled - changed - day.changes.failed), failed: day.changes.failed },
                };
              })}
              line={{ name: 'Model cost', values: daily.map((day) => day.costUsd), format: money, tick: moneyTick }}
            />
          ) : null}
          {failed > 0 && view !== 'trouble' ? (
            <Failure>
              {plural(failed, 'change')} failed. <TextLink href="/activity?show=trouble">See {failed === 1 ? 'it' : 'them'}</TextLink>
            </Failure>
          ) : null}
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Loading rows={8} />
      ) : !data || data.rows.length === 0 ? (
        <Empty>{search !== '' ? 'Nothing matches.' : view === '' ? 'sift has changed nothing in Gmail in this period.' : 'Nothing in this period.'}</Empty>
      ) : (
        <MailLog rows={data.rows} onOpen={onOpen} onUndo={undo} onRetry={retry} search={search} />
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
