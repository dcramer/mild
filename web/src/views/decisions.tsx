import { type ReactNode, useEffect, useState } from 'react';
import { ErrorNote } from '@/components/bits.tsx';
import { DecisionTable } from '@/components/decision-table.tsx';
import { type Days, type DecisionRow, api, useLoaded } from '@/lib/api.ts';
import { DISPOSITION_KEYS, TIERS, count, dispositionName } from '@/lib/format.ts';
import { Button, Empty, Input, Loading, Select, Sheet } from '@/system';

const PAGE = 50;
const TIER_OPTIONS = [['', 'Any tier'], ...TIERS.map((t) => [t.key, t.name] as const)] as const;
const OUTCOME_OPTIONS = [['', 'Any outcome'], ...DISPOSITION_KEYS.map((k) => [k, dispositionName(k)] as const)] as const;

export function Decisions({ days, period, onOpen }: { days: Days; period: ReactNode; onOpen: (row: DecisionRow) => void }) {
  const [stage, setStage] = useState('');
  const [disposition, setDisposition] = useState('');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  // Search as the viewer types, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => setOffset(0), [days, stage, disposition, search]);

  const query = { days, stage, disposition, search, limit: PAGE, offset };
  const { data, error, loading } = useLoaded(JSON.stringify(query), (signal) => api.decisions(query, signal));
  const filtered = stage !== '' || disposition !== '' || search !== '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-80"
          type="search"
          placeholder="Search subject or sender"
          aria-label="Search subject or sender"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Select label="Tier" value={stage} options={TIER_OPTIONS} onChange={setStage} />
        <Select label="Outcome" value={disposition} options={OUTCOME_OPTIONS} onChange={setDisposition} />
        {period}
        {data ? <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">{count(data.total)} decisions</span> : null}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      <Sheet>
        {loading ? (
          <Loading rows={8} />
        ) : !data || data.rows.length === 0 ? (
          <Empty>{filtered ? 'No decisions match these filters.' : 'No decisions in this period.'}</Empty>
        ) : (
          <DecisionTable rows={data.rows} onOpen={onOpen} search={search} />
        )}
      </Sheet>
      {data && data.total > PAGE ? (
        <div className="flex items-center justify-end gap-2 text-[13px] text-muted-foreground tabular-nums">
          <span>
            {count(offset + 1)}–{count(Math.min(offset + PAGE, data.total))} of {count(data.total)}
          </span>
          <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Newer
          </Button>
          <Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            Older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
