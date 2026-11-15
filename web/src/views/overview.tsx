import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Button, Highlight, Sheet, SheetHead } from '@/system';
import { DispositionBadge, Empty, NUM, TD, TH, TierLabel } from '@/components/bits.tsx';
import { DecisionTable } from '@/components/decision-table.tsx';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DecisionRow, Summary } from '@/lib/api.ts';
import { TIERS, count, longDay, money, percent, shortDay } from '@/lib/format.ts';

const chartConfig = Object.fromEntries(TIERS.map((t) => [t.key, { label: t.name, color: t.color }])) satisfies ChartConfig;

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string | null; tone?: 'highlight' | 'alert' }) {
  return (
    <div className="flex flex-col gap-1 bg-card px-4 py-3.5">
      <dt className="slug truncate text-muted-foreground">{label}</dt>
      <dd className={`figure ${tone === 'alert' ? 'text-destructive' : ''}`}>
        {tone === 'highlight' ? <Highlight className="mx-0 inline-block px-2 py-0">{value}</Highlight> : value}
      </dd>
      <dd className="min-h-4 truncate text-xs text-muted-foreground tabular-nums">{note}</dd>
    </div>
  );
}

// Only the top of each column is rounded: the last tier with any decisions that day.
const topTier = (row: Summary['daily'][number]) => TIERS.findLast((t) => row.counts[t.key] > 0)?.key;

function PerDay({ daily }: { daily: Summary['daily'] }) {
  const data = daily.map((d) => ({ day: d.day, ...d.counts }));
  return (
    <div className="flex flex-col gap-3 p-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        {TIERS.map((t) => (
          <li key={t.key}>
            <TierLabel stage={t.key} />
          </li>
        ))}
      </ul>
      <ChartContainer config={chartConfig} className="aspect-auto h-60 w-full">
        <BarChart data={data} accessibilityLayer margin={{ left: 0, right: 4, top: 8 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={shortDay} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tickFormatter={count} />
          <ChartTooltip content={<ChartTooltipContent className="min-w-48" labelFormatter={(value) => longDay(String(value))} />} />
          {TIERS.map((t) => (
            <Bar
              key={t.key}
              dataKey={t.key}
              stackId="tiers"
              fill={`var(--color-${t.key})`}
              maxBarSize={28}
              isAnimationActive={false}
              shape={(props: { x?: number; y?: number; width?: number; height?: number; index?: number }) => {
                const { x = 0, y = 0, width = 0, height = 0, index = 0 } = props;
                const row = daily[index];
                const r = row && topTier(row) === t.key ? Math.min(3, width / 2, height) : 0;
                return (
                  <path
                    d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`}
                    fill={`var(--color-${t.key})`}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                  />
                );
              }}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export function Overview({ data, onOpen, onViewAll }: { data: Summary; onOpen: (row: DecisionRow) => void; onViewAll: () => void }) {
  const t = data.totals;
  return (
    <div className="flex flex-col gap-4">
      {/* One strip of figures, divided by hairlines. The first is the point of sift, so it gets the highlighter. */}
      <dl className="sheet stats grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4 xl:grid-cols-7 [&>div:last-child]:col-span-2 xl:[&>div:last-child]:col-span-1">
        <Stat
          label="No model needed"
          value={percent(t.withoutInference, t.decisions)}
          note={t.decisions ? `${count(t.withoutInference)} of ${count(t.decisions)}` : null}
          tone={t.decisions ? 'highlight' : undefined}
        />
        <Stat label="Decisions" value={count(t.decisions)} />
        <Stat label="Messages received" value={count(t.messages)} />
        <Stat label="Model cost" value={money(t.costUsd)} note={t.decisions ? `${money(t.costUsd / t.decisions)} each` : null} />
        <Stat label="Awaiting triage" value={count(t.awaitingTriage)} />
        <Stat label="Questions for you" value={count(t.openQuestions)} tone={t.openQuestions > 0 ? 'highlight' : undefined} />
        <Stat
          label="Actions to check"
          value={count(t.troubledActions)}
          note={t.troubledActions ? 'see sift log' : null}
          tone={t.troubledActions > 0 ? 'alert' : undefined}
        />
      </dl>

      <div className="grid gap-4 lg:grid-cols-5">
        <Sheet className="lg:col-span-3">
          <SheetHead title="Decisions per day" description="Darker ink is a cheaper tier." />
          {t.decisions === 0 ? <Empty>No decisions in this period.</Empty> : <PerDay daily={data.daily} />}
        </Sheet>

        <Sheet className="lg:col-span-2">
          <SheetHead title="By tier" />
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>Tier</TableHead>
                <TableHead className={`${TH} text-right`}>Decisions</TableHead>
                <TableHead className={`${TH} text-right`}>Share</TableHead>
                <TableHead className={`${TH} text-right`}>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byStage.map((row) => (
                <TableRow key={row.stage}>
                  <TableCell className={TD}>
                    <TierLabel stage={row.stage} />
                  </TableCell>
                  <TableCell className={`${TD} ${NUM}`}>{count(row.decisions)}</TableCell>
                  <TableCell className={`${TD} ${NUM}`}>{percent(row.decisions, t.decisions)}</TableCell>
                  <TableCell className={`${TD} ${NUM}`}>{money(row.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Sheet>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Sheet className="lg:col-span-3">
          <SheetHead title="Most frequent senders" />
          {data.topSenders.length === 0 ? (
            <Empty>No mail recorded in this period.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={TH}>Sender</TableHead>
                  <TableHead className={`${TH} text-right`}>Messages</TableHead>
                  <TableHead className={TH}>Latest outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topSenders.map((row) => (
                  <TableRow key={row.address}>
                    <TableCell className={`${TD} max-w-64 truncate`}>{row.address}</TableCell>
                    <TableCell className={`${TD} ${NUM}`}>{count(row.messages)}</TableCell>
                    <TableCell className={TD}>
                      {row.lastDisposition ? (
                        <DispositionBadge disposition={row.lastDisposition} />
                      ) : (
                        <span className="text-muted-foreground">Not decided</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Sheet>

        <Sheet className="lg:col-span-2">
          <SheetHead title="Outcomes" />
          {data.byDisposition.length === 0 ? (
            <Empty>Nothing decided in this period.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={TH}>Outcome</TableHead>
                  <TableHead className={`${TH} text-right`}>Decisions</TableHead>
                  <TableHead className={`${TH} text-right`}>Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byDisposition.map((row) => (
                  <TableRow key={row.disposition}>
                    <TableCell className={TD}>
                      <DispositionBadge disposition={row.disposition} />
                    </TableCell>
                    <TableCell className={`${TD} ${NUM}`}>{count(row.decisions)}</TableCell>
                    <TableCell className={`${TD} ${NUM}`}>{percent(row.decisions, t.decisions)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Sheet>
      </div>

      <Sheet>
        <SheetHead
          title="Latest decisions"
          action={
            <Button variant="plain" size="sm" onClick={onViewAll}>
              View all
            </Button>
          }
        />
        {data.recent.length === 0 ? (
          <Empty>No decisions yet. sift records one each time it triages a message, including when it leaves the message alone.</Empty>
        ) : (
          <DecisionTable rows={data.recent} onOpen={onOpen} />
        )}
      </Sheet>
    </div>
  );
}
