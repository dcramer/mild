'use client';
import { ArchiveIcon, TagIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Verdict } from '@/components/bits.tsx';
import { ContactHint } from '@/components/sender.tsx';
import { ACTIONS } from '@/lib/words.ts';
import { money, moneyTick } from '@/lib/format.ts';
import {
  Blank,
  Does,
  LabelSheet,
  Button,
  Empty,
  Fact,
  Facts,
  Figure,
  Figures,
  Loading,
  LoadingBar,
  Meter,
  Reserve,
  Rope,
  Section,
  Select,
  Share,
  SettingRow,
  SettingsGroup,
  Sheet,
  Spark,
  StackedBars,
  Sub,
  Swipe,
  Table,
  Td,
  TextLink,
  Timeline,
  TimelineEvent,
  Tr,
  useToast,
} from '@/system';
import { DAILY_COST, SERIES, DAYS, SHEET_LABELS } from './samples.tsx';

/** Facts, figures and settings, and a list while it is empty or loading. */
export function Sheets() {
  const toast = useToast();
  const [waiting, setWaiting] = useState(false);
  return (
    <>
      <div className="grid gap-14 lg:grid-cols-2">
        <Section title="Facts">
          <Facts>
            <Fact term="Mail">14 messages since Oct 20, 2026</Fact>
            <Fact term="Domain">
              <span className="inline-flex items-center gap-2">
                <TextLink href="/system">example.com</TextLink>
                <ContactHint contact="one-way" />
              </span>
            </Fact>
          </Facts>
        </Section>
        <Section title="Timeline">
          <Timeline>
            <TimelineEvent at="Nov 13, 3:21 PM" title={<Verdict labelId="marketing" labelName="Marketing" disposition="archive" />}>
              <p>Reads as a promotion.</p>
            </TimelineEvent>
            <TimelineEvent at="Nov 13, 3:22 PM" title={<span className="font-medium">Archived in Gmail</span>} action={<Button>Undo</Button>} />
          </Timeline>
        </Section>
      </div>

      <Section title="Figures, chart and share">
        <div className="grid items-start gap-x-12 gap-y-8 lg:grid-cols-[auto_minmax(0,1fr)]">
          <Figures className="gap-x-8">
            <Figure label="No model needed" value="84%" note="1,079 of 1,284" />
            <Figure label="Waiting on you" value="23" tone="look" />
            <Figure label="Rules" value="12" href="/system" />
          </Figures>
          <StackedBars
            compact
            series={SERIES}
            rows={DAYS}
            line={{ name: 'Model cost', values: [0.04, 0.02, 0.06, 0, 0.03, 0.08, 0.05], format: money, tick: moneyTick }}
          />
        </div>
        <div className="flex w-80 max-w-full flex-col gap-4">
          <Figures compact>
            <Figure compact label="24H" value="$0.14" />
            <Figure compact label="7D" value="$0.96" />
            <Figure compact label="30D" value="$4.12" />
          </Figures>
          <Spark values={DAILY_COST} from="Oct 19" to="Today" />
        </div>
        <dl className="grid max-w-xl grid-cols-[8rem_minmax(0,1fr)_3rem] items-center gap-x-4 gap-y-2 text-sm">
          {[
            ['Notifications', 1067],
            ['Marketing', 593],
            ['Phishing', 8],
          ].map(([name, part]) => (
            <Fragment key={name}>
              <dt>{name}</dt>
              <dd>
                <Share part={Number(part)} whole={3255} />
              </dd>
              <dd className="text-right text-muted-foreground tabular-nums">{part}</dd>
            </Fragment>
          ))}
          <dt>Not counted yet</dt>
          <dd>
            <Share part={0} whole={null} />
          </dd>
          <dd />
        </dl>
      </Section>

      <div className="grid gap-14 lg:grid-cols-2">
        <Section title="Settings in a sheet" meta="a settings page is groups: what each governs on the left, its sheet on the right">
          <SettingsGroup title="Active" note="Whether Mild changes your Gmail.">
            <Sheet>
              <SettingRow title="Off" note="Nothing in Gmail changes. Mild suggests, and learns from your answers.">
                <Button>Turn on</Button>
              </SettingRow>
              <SettingRow title="Check for mail" note="Last checked 1 min ago.">
                <Select
                  label="How often"
                  value="60"
                  options={[
                    ['60', 'Every minute'],
                    ['300', 'Every 5 minutes'],
                  ]}
                  onChange={() => {}}
                />
              </SettingRow>
            </Sheet>
          </SettingsGroup>
        </Section>
        <Section title="Empty and loading" meta="rows set like the real ones, with a blank for each piece of text">
          <Empty
            art={<Rope />}
            after={
              <>
                <p>Mild is off. Nothing it suggests is done in Gmail until you turn it on.</p>
                <Button href="#system">Turn Mild on…</Button>
              </>
            }
          >
            Nothing is waiting on you.
          </Empty>
          <Empty>Nothing waiting matches.</Empty>
          <Loading rows={3}>
            <Td className="max-w-0 md:w-1/3">
              <span className="name">
                <Blank />
              </span>
              <Sub>
                <Blank />
              </Sub>
            </Td>
            <Td phone="hide" className="max-w-0 md:w-full">
              <Blank />
            </Td>
            <Td phone="hide" num>
              <Blank word />
            </Td>
          </Loading>
          <Loading rows={3} />
          <div>
            <Button
              onClick={() => {
                setWaiting(true);
                setTimeout(() => setWaiting(false), 3000);
              }}
            >
              Wait three seconds
            </Button>
            <LoadingBar on={waiting} />
          </div>
        </Section>
        <Section
          title="Swipe"
          meta="a row of mail on a phone: slid a little, a press shows; to the edge, it is done. Held, a row is selected, and the list's presses go along the bottom"
        >
          <Table dense>
            <tbody>
              {(['', 'start', 'end'] as const).map((opened) => (
                <Tr key={opened} onOpen={() => toast('Opened')}>
                  <Td className="max-w-0">
                    <Swipe
                      {...(opened ? { opened } : {})}
                      start={{ label: 'Label', icon: <TagIcon />, onPress: () => toast('Label') }}
                      end={{ label: 'Archive', icon: <ArchiveIcon />, onPress: () => toast('Archived') }}
                    >
                      <span className="flex flex-col leading-snug">
                        <span className="name">Weekly Digest</span>
                        <span className="truncate">This week in widgets</span>
                        <span className="truncate text-muted-foreground">Five stories about widgets.</span>
                      </span>
                    </Swipe>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
        <Section title="Label sheet" meta="on a phone, what one conversation is: Inbox's swipe right">
          <LabelSheetSpecimen />
        </Section>
        <Section title="Reserve" meta="holds the room for what arrives late, so nothing below moves">
          <Reserve id="specimen" ready={false} room="min-h-24" placeholder={<Loading rows={2} />}>
            <span />
          </Reserve>
          <p className="text-muted-foreground">This line stays where it is when the part above fills in.</p>
        </Section>
      </div>
    </>
  );
}

function LabelSheetSpecimen() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Label…</Button>
      {open ? (
        <LabelSheet
          open
          onClose={() => setOpen(false)}
          who="Store"
          subject="48 hours only: 30% off everything"
          value="marketing"
          groups={SHEET_LABELS.map((group) =>
            group.map(([id, label, does, sure]) => ({
              id,
              label,
              does: <Does action={does}>{ACTIONS.find(([k]) => k === does)?.[1] ?? does}</Does>,
              ...(sure ? { lead: <Meter level={sure} /> } : {}),
            })),
          )}
          onPick={(id) => toast(`Saved: ${id}`)}
          ending={{ onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') }}
        />
      ) : null}
    </div>
  );
}
