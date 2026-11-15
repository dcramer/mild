import type { ReactNode } from 'react';
import { DispositionBadge, TierLabel } from '@/components/bits.tsx';
import { DecisionTable } from '@/components/decision-table.tsx';
import type { DecisionRow, Summary } from '@/lib/api.ts';
import { TIERS, count, longDay, money, percent, shortDay } from '@/lib/format.ts';
import { Button, Empty, Figure, Figures, Sheet, SheetHead, StackedBars, Table, Td, Th, Tr } from '@/system';

export function Overview({ data, period, onOpen }: { data: Summary; period: ReactNode; onOpen: (row: DecisionRow) => void }) {
  const t = data.totals;
  // Before senders were folded into rules they were a tier of their own. It is shown only where that history exists.
  const used = (stage: string) => stage !== 'sender' || data.byStage.some((row) => row.stage === 'sender' && row.decisions > 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <Figures>
          {/* The first is the point of sift, so it gets the highlighter. */}
          <Figure
            label="No model needed"
            value={percent(t.withoutInference, t.decisions)}
            note={t.decisions ? `${count(t.withoutInference)} of ${count(t.decisions)}` : null}
            tone={t.decisions ? 'look' : undefined}
          />
          <Figure label="Decisions" value={count(t.decisions)} note={`${count(t.messages)} received`} />
          <Figure label="Model cost" value={money(t.costUsd)} note={t.decisions ? `${money(t.costUsd / t.decisions)} each` : null} />
          {t.awaitingTriage > 0 ? <Figure label="Not yet sorted" value={count(t.awaitingTriage)} /> : null}
          {t.openQuestions > 0 ? <Figure label="Questions for you" value={count(t.openQuestions)} tone="look" /> : null}
          {t.troubledActions > 0 ? <Figure label="Changes to check" value={count(t.troubledActions)} note="under Changes" tone="failure" /> : null}
        </Figures>
        <div className="ml-auto">{period}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Sheet className="lg:col-span-3">
          <SheetHead title="Decisions per day" description="Darker ink is a cheaper tier." />
          {t.decisions === 0 ? (
            <Empty>No decisions in this period.</Empty>
          ) : (
            <StackedBars
              unit="decisions"
              series={TIERS.filter((tier) => used(tier.key))}
              rows={data.daily.map((d) => ({ key: d.day, label: shortDay(d.day), title: longDay(d.day), values: d.counts }))}
            />
          )}
        </Sheet>

        <Sheet className="lg:col-span-2">
          <SheetHead title="By tier" />
          <Table>
            <thead>
              <Tr>
                <Th>Tier</Th>
                <Th num>Decisions</Th>
                <Th num>Share</Th>
                <Th num>Cost</Th>
              </Tr>
            </thead>
            <tbody>
              {data.byStage
                .filter((row) => used(row.stage))
                .map((row) => (
                  <Tr key={row.stage}>
                    <Td>
                      <TierLabel stage={row.stage} />
                    </Td>
                    <Td num>{count(row.decisions)}</Td>
                    <Td num>{percent(row.decisions, t.decisions)}</Td>
                    <Td num>{money(row.costUsd)}</Td>
                  </Tr>
                ))}
            </tbody>
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
              <thead>
                <Tr>
                  <Th>Sender</Th>
                  <Th num>Messages</Th>
                  <Th>Latest outcome</Th>
                </Tr>
              </thead>
              <tbody>
                {data.topSenders.map((row) => (
                  <Tr key={row.address}>
                    <Td className="max-w-64 truncate">{row.address}</Td>
                    <Td num>{count(row.messages)}</Td>
                    <Td>
                      {row.lastDisposition ? (
                        <DispositionBadge disposition={row.lastDisposition} />
                      ) : (
                        <span className="text-muted-foreground">Not decided</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Sheet>

        <Sheet className="lg:col-span-2">
          <SheetHead title="Outcomes" />
          {data.byDisposition.length === 0 ? (
            <Empty>Nothing decided in this period.</Empty>
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>Outcome</Th>
                  <Th num>Decisions</Th>
                  <Th num>Share</Th>
                </Tr>
              </thead>
              <tbody>
                {data.byDisposition.map((row) => (
                  <Tr key={row.disposition}>
                    <Td>
                      <DispositionBadge disposition={row.disposition} />
                    </Td>
                    <Td num>{count(row.decisions)}</Td>
                    <Td num>{percent(row.decisions, t.decisions)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Sheet>
      </div>

      <Sheet>
        <SheetHead title="Latest decisions" action={<Button href="#decisions">View all</Button>} />
        {data.recent.length === 0 ? (
          <Empty>No decisions yet. sift records one each time it sorts a message, including when it leaves the message alone.</Empty>
        ) : (
          <DecisionTable rows={data.recent} onOpen={onOpen} />
        )}
      </Sheet>
    </div>
  );
}
