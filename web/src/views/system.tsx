import { ArrowRightIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { StatusWord, TierLabel, Verdict } from '@/components/bits.tsx';
import { ACTIONS, STANDINGS, STATUS_NAMES, TIERS, money, moneyTick, outcomeName } from '@/lib/format.ts';
import {
  Does,
  AnswerPicker,
  ActionIcon,
  Avatar,
  Button,
  Check,
  ChoiceGroup,
  Code,
  ConfirmButton,
  Copyable,
  Dialog,
  Clause,
  Disclosure,
  Document,
  Empty,
  Entry,
  Fact,
  Facts,
  Failure,
  Field,
  Figure,
  Figures,
  FilterGroup,
  Form,
  Highlight,
  HoverCard,
  Input,
  Kbd,
  ListView,
  Look,
  Loading,
  Marked,
  Masthead,
  Menu,
  Meter,
  Note,
  Notice,
  OnPhone,
  PageHeader,
  Panel,
  Reserve,
  RowActions,
  Section,
  Select,
  Share,
  SettingRow,
  SettingsGroup,
  Sheet,
  StackedBars,
  Stamp,
  Sub,
  Swatch,
  Table,
  Td,
  TextArea,
  TextLink,
  Th,
  Timeline,
  TimelineEvent,
  Tr,
  TrGroup,
  useToast,
  Wordmark,
} from '@/system';

const SERIES = TIERS.map((t, index) => ({ key: String(index), name: t.name, color: t.color }));
const DAYS = [
  [12, 5, 3, 1],
  [8, 9, 2, 0],
  [15, 4, 6, 2],
  [0, 0, 0, 0],
  [9, 11, 1, 0],
  [20, 6, 4, 3],
  [14, 7, 2, 1],
].map((counts, index) => ({
  key: String(index),
  label: `Nov ${index + 9}`,
  title: `Nov ${index + 9}`,
  values: Object.fromEntries(counts.map((n, i) => [String(i), n])),
}));
const LABELS = [
  ['personal', 'Personal'],
  ['newsletter', 'Newsletters'],
  ['marketing', 'Marketing'],
  ['junk', 'Junk'],
] as const;
const ROWS = [
  { sender: 'Example Weekly', address: 'news@example.com', subject: 'Five things to read', label: 'Newsletters', does: 'archive' },
  { sender: 'Ada at Example', address: 'ada@example.org', subject: 'Dinner on Saturday?', label: 'Personal', does: 'keep' },
  { sender: 'founder@example.net', address: 'founder@example.net', subject: 'Quick question', label: null, does: 'review' },
];

const INKS = [
  ['bg-background', 'background', 'The page.'],
  ['bg-popover', 'popover', 'What floats: a dialog, a menu, a toast.'],
  ['bg-foreground', 'foreground', 'Ink: text, and the main action.'],
  ['bg-muted-foreground', 'muted-foreground', 'Secondary text.'],
  ['bg-(--frame)', '--frame', 'A sheet’s edge.'],
  ['bg-(--rule)', '--rule', 'Lines between rows, dashed.'],
  ['bg-(--fill)', '--fill', 'What a control is filled with.'],
  ['bg-highlight', 'highlight', 'Look here. Nothing else is yellow.'],
  ['bg-destructive', 'destructive', 'A failure. Nothing else is red.'],
] as const;

const VARIANTS = [
  ['mark', 'What the screen is waiting on. One per screen, at most, never down a list.'],
  ['ink', 'What finishes a dialog or a form. Never down a list.'],
  ['plain', 'A page’s own action, and everything else said once.'],
  ['quiet', 'Repeated down a list (firmer when its row is pointed at), and ways out.'],
] as const;

/** Every part of the design system in every state, at `/system`. Add to it when the system grows. */
export function SystemView() {
  const [choice, setChoice] = useState<(typeof ACTIONS)[number][0]>('archive');
  const [label, setLabel] = useState<string | null>('newsletter');
  const [standing, setStanding] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [panel, setPanel] = useState(false);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState('');
  const [made, setMade] = useState('');
  const toast = useToast();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 py-8 md:px-6">
      <PageHeader title="Design system" meta="Every part, in every state. The rules for using them are in docs/DESIGN.md." />

      <Section title="Ink">
        <Sheet>
          <div className="grid grid-cols-2 gap-px bg-(--rule) sm:grid-cols-3">
            {INKS.map(([swatch, name, use]) => (
              <div key={name} className="flex flex-col gap-2 bg-background p-4">
                <span aria-hidden className={`h-10 border border-(--frame) ${swatch}`} />
                <span className="font-mono text-sm">{name}</span>
                <span className="text-muted-foreground">{use}</span>
              </div>
            ))}
          </div>
        </Sheet>
      </Section>

      <Section title="Type">
        <Sheet>
          <Row label="wordmark" note="The name, and only the name. large on the sign-in screen.">
            <p className="flex items-baseline gap-6">
              <Wordmark />
              <Wordmark size="lg" />
            </p>
          </Row>
          <Row label="statement" note="A page’s title, and nothing else.">
            <p className="statement">Suggestions</p>
          </Row>
          <Row label="figure">
            <p className="figure">
              1,284 <Highlight className="mx-0">37</Highlight>
            </p>
          </Row>
          <Row label="title" note="A dialog’s or a panel’s title.">
            <p className="title">Add a rule</p>
          </Row>
          <Row label="heading" note="A section of a page or a panel.">
            <p className="heading">Proposed rules</p>
          </Row>
          <Row label="name">
            <p className="name">A sender, a label, an account</p>
          </Row>
          <Row label="body">
            <p>
              Text, 16px; 15px beside it. <span className="text-muted-foreground">Secondary text is lighter, not smaller.</span> A <Code>command</Code> inline,
              a <TextLink href="/system">link</TextLink>, a link to{' '}
              <TextLink href="https://example.com" away>
                another site
              </TextLink>
              , a key <Kbd>Enter</Kbd>.
            </p>
          </Row>
          <Row label="slug" note="Column heads and a figure’s label. Not headings.">
            <p className="slug text-muted-foreground">Sender · Messages</p>
          </Row>
          <Row label="look" note="What is left to the reader, in a line of text.">
            <p>
              <Look>Not sure</Look> <span className="text-muted-foreground">· 3 messages</span>
            </p>
          </Row>
          <Row label="swatch" note="A series’ or a tier’s colour, beside its name.">
            <p className="inline-flex items-center gap-2">
              <Swatch color="var(--tier-classifier)" />
              Model
            </p>
          </Row>
        </Sheet>
      </Section>

      <Section title="Words" meta="lib/format.ts: one name for each thing, everywhere">
        <Sheet>
          <Row label="sift does" note="Its icon and its word, the same whether suggested, done or a setting. Never what comes with it.">
            {ACTIONS.map(([key]) => (
              <Does key={key} action={key}>
                {outcomeName(key)}
              </Does>
            ))}
            <Does action="review">{outcomeName('review')}</Does>
          </Row>
          <Row label="verdict" note="What sift says mail is and does: the action, then the label.">
            <Verdict labelName="Newsletters" disposition="archive" />
            <Verdict labelName={null} disposition="review" />
          </Row>
          <Row label="meter" note="How sure sift is about a label, in three steps. A suggestion's label is its answer button, meter first.">
            <Meter level={1} />
            <Meter level={2} />
            <Meter level={3} />
            <Button>
              <Meter level={3} />
              Marketing
            </Button>
            <Button>
              <Meter level={1} />
              Receipts
            </Button>
          </Row>
          <Row label="status" note="Where a decision got to in Gmail. Only a failure is red.">
            {(['suggested', 'done', 'undone'] as const).map((s) => (
              <span key={s} className="text-muted-foreground">
                {STATUS_NAMES[s]}
              </span>
            ))}
            <StatusWord row={{ carryOut: true, outcome: 'failed', actionStatus: null, outcomeDetail: 'Gmail answered 503' }} />
          </Row>
          <Row label="standing">
            {Object.values(STANDINGS).map((name) => (
              <Stamp key={name}>{name}</Stamp>
            ))}
          </Row>
          <Row label="tier">
            {TIERS.map((t) => (
              <TierLabel key={t.key} stage={t.key} />
            ))}
          </Row>
        </Sheet>
      </Section>

      <Section title="Button" meta="corners cut by hand; given an address it is a link">
        <Sheet>
          {VARIANTS.map(([variant, use]) => (
            <Row key={variant} label={variant} note={use}>
              <Button variant={variant}>Standard</Button>
              <Button variant={variant} size="lg">
                Large
                <ArrowRightIcon aria-hidden />
              </Button>
              <Button variant={variant} disabled>
                Disabled
              </Button>
              <Button variant={variant} busy>
                Busy
              </Button>
            </Row>
          ))}
          <Row label="why" note="Disabled with its reason, shown on hover and read with the button.">
            <Button variant="quiet" size="icon" aria-label="Remove" disabled why="You cannot delete your only remaining mailbox.">
              <Trash2Icon />
            </Button>
          </Row>
          <Row label="confirm" note="A press that cannot be taken back asks first, in place.">
            <ConfirmButton question="Remove this rule?" onConfirm={() => toast('Removed the rule.')}>
              Remove
            </ConfirmButton>
            <ConfirmButton question="Remove this rule?" icon={<Trash2Icon aria-hidden />} onConfirm={() => toast('Removed the rule.')}>
              Remove
            </ConfirmButton>
          </Row>
        </Sheet>
      </Section>

      <Section title="Controls">
        <Sheet>
          <Row label="select" note="A short list.">
            <Select label="What sift does" value={choice} options={ACTIONS} onChange={setChoice} />
            <Select
              label="With icons"
              value={choice}
              options={ACTIONS}
              icons={Object.fromEntries(ACTIONS.map(([key]) => [key, <ActionIcon action={key} />]))}
              onChange={setChoice}
            />
            <Select label="Disabled" value={choice} options={ACTIONS} onChange={setChoice} disabled />
          </Row>
          <Row
            label="shortcut"
            note="A control asks for its key and draws the keycap itself, so a key shown always works. Off in Settings, and never drawn on a touch screen. In a row, live only on the row you are on."
          >
            <Button shortcut="g" onClick={() => toast('G was pressed')}>
              Press me
            </Button>
            <Button variant="mark" shortcut={{ key: 'Enter', label: 'Send' }} onClick={() => toast('Enter was pressed')}>
              Send
            </Button>
            <span className="text-muted-foreground">
              <Kbd>?</Kbd> lists every key that works here
            </span>
          </Row>
          <Row label="choice group" note="A few choices seen at once, one on. Numbered where keys pick them; clearable where none is a choice too.">
            <ChoiceGroup label="What this is" value={label} options={LABELS} onChange={setLabel} numbered />
            <ChoiceGroup
              label="Standing"
              value={standing}
              options={[
                ['trusted', 'Trust'],
                ['blocked', 'Block'],
              ]}
              onChange={setStanding}
              clearable
            />
          </Row>
          <Row label="input">
            <Input aria-label="Example" placeholder="example.com" className="w-56" />
            <Input aria-label="Disabled" placeholder="Disabled" className="w-40" disabled />
          </Row>
          <Row label="check">
            <Check checked={checked} onChange={setChecked}>
              Mark it read
            </Check>
          </Row>
          <Row label="text area">
            <div className="w-full max-w-xl">
              <TextArea aria-label="Example" className="min-h-20" defaultValue="Anything from my accountant stays in the inbox." />
            </div>
          </Row>
        </Sheet>
      </Section>

      <Section title="Form" meta="fields, one under another, the action last">
        <div className="grid gap-10 md:grid-cols-2">
          <Form onSubmit={() => toast('Saved.')}>
            <Field label="Name" hint="In Gmail it stays sift/newsletters.">
              <Input aria-label="Name" className="w-full" defaultValue="Newsletters" />
            </Field>
            <Field label="Then" hint="It leaves the inbox and stays findable under its label.">
              <Select label="Then" value={choice} options={ACTIONS} onChange={setChoice} />
            </Field>
            <Field label="Words" error="The subject must contain something.">
              <Input aria-label="Words" className="w-full" />
            </Field>
            <div>
              <Button type="submit" variant="ink">
                Save
              </Button>
            </div>
          </Form>
          <div className="flex flex-col gap-2.5">
            <p className="text-muted-foreground">Inline, for a short form in a narrow column:</p>
            <Field inline label="Covers">
              <Select
                label="Covers"
                value="sender"
                options={[
                  ['sender', 'Everything from this sender'],
                  ['once', 'Only this message'],
                ]}
                onChange={() => {}}
              />
            </Field>
            <Field inline label="Then">
              <Select label="Then" value={choice} options={ACTIONS} onChange={setChoice} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Page header and section" meta="the top of every page, and the parts under it">
        <Sheet className="gap-8 p-5">
          <PageHeader
            title="Rules"
            actions={
              <Button>
                <PlusIcon aria-hidden />
                Add a rule
              </Button>
            }
          />
          <Section title="Proposed rules" meta="2" action={<TextLink href="/system">See all</TextLink>}>
            <p className="text-muted-foreground">A section’s content. No rule or box sets it apart, only space.</p>
          </Section>
        </Sheet>
      </Section>

      <Section title="List view" meta="how every screen shows many of one thing">
        <Sheet className="p-5">
          <ListView
            title="Suggestions"
            actions={<span className="text-muted-foreground">This week 84% without a model</span>}
            search={{ value: search, onChange: setSearch, placeholder: 'Search' }}
            filters={{
              active: made === '' ? [] : [{ label: `Then: ${outcomeName(made)}`, clear: () => setMade('') }],
              panel: <FilterGroup label="Then" value={made} options={[['', 'Anything'], ...ACTIONS]} onChange={setMade} />,
            }}
          >
            <Table keys>
              <thead className="sr-only">
                <Tr>
                  <Th>Sender</Th>
                  <Th phone="hide">Subject</Th>
                  <Th>Label</Th>
                </Tr>
              </thead>
              <tbody>
                {ROWS.filter((row) => (made === '' || row.does === made) && `${row.sender} ${row.subject}`.toLowerCase().includes(search.toLowerCase())).map(
                  (row) => (
                    <Tr key={row.address} onOpen={() => setPanel(true)}>
                      <Td className="max-w-0 md:w-1/3">
                        <span className="name block truncate">{row.sender}</span>
                        <Sub>{row.address}</Sub>
                        <OnPhone>
                          <span className="w-full truncate">{row.subject}</span>
                        </OnPhone>
                      </Td>
                      <Td phone="hide" className="max-w-0 md:w-full">
                        <span className="block truncate">
                          <Marked text={row.subject} term={search} />
                        </span>
                      </Td>
                      <RowActions phone="keep">
                        <AnswerPicker
                          className="w-60"
                          label="What this message is"
                          value={row.label === null ? null : (LABELS.find(([, name]) => name === row.label)?.[0] ?? null)}
                          groups={[
                            LABELS.slice(0, 2).map(([id, name], i) => ({ id, label: name, lead: <Meter level={i === 0 ? 3 : 1} /> })),
                            LABELS.slice(2).map(([id, name]) => ({ id, label: name })),
                          ]}
                          empty={<Look>Which label?</Look>}
                          extra={{ label: 'Add a label…', onSelect: () => toast('Adds a label, then it is among the choices.') }}
                          onSubmit={(id) => toast(`Answered: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`)}
                        />
                      </RowActions>
                    </Tr>
                  ),
                )}
              </tbody>
            </Table>
          </ListView>
        </Sheet>
        <p className="text-muted-foreground">
          On a phone the table keeps its first column; what the others said moves under it, and the row opens for the rest.
        </p>
      </Section>

      <Section title="A log" meta="a few ways to see the list; one table, a heading for each day">
        <Sheet className="p-5">
          <ListView
            title="Activity"
            view={{
              label: 'Show',
              value: shown,
              options: [
                ['', 'Changed'],
                ['all', 'Everything'],
              ],
              onChange: setShown,
            }}
          >
            <Table keys>
              <thead className="sr-only">
                <Tr>
                  <Th>Sender</Th>
                  <Th phone="hide">Subject</Th>
                  <Th phone="hide">What happened</Th>
                </Tr>
              </thead>
              {(
                [
                  ['Today', ROWS.slice(0, 2)],
                  ['Yesterday', ROWS.slice(2, 3)],
                ] as const
              ).map(([day, rows]) => (
                <tbody key={day}>
                  <TrGroup title={day} span={3} />
                  {rows.map((row) => (
                    <Tr key={row.address} onOpen={() => setPanel(true)}>
                      <Td className="max-w-0 md:w-1/3">
                        <span className="name block truncate">{row.sender}</span>
                      </Td>
                      <Td phone="hide" quiet className="max-w-0 md:w-full">
                        <span className="block truncate">{row.subject}</span>
                      </Td>
                      <Td phone="hide" className="whitespace-nowrap">
                        <span className="font-semibold">Archived</span>
                        <span className="text-muted-foreground"> · {row.label ?? 'Newsletters'}</span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              ))}
            </Table>
          </ListView>
        </Sheet>
      </Section>

      <div className="grid gap-14 lg:grid-cols-2">
        <Section title="Facts">
          <Facts>
            <Fact term="Standing">
              <span className="inline-flex items-center gap-2">
                <Stamp>Known</Stamp>
                <span className="text-muted-foreground">their mail is consistently one kind</span>
              </span>
            </Fact>
            <Fact term="Mail">14 messages since Oct 20, 2026</Fact>
            <Fact term="Domain">
              <TextLink href="/system">example.com</TextLink>
            </Fact>
          </Facts>
        </Section>
        <Section title="Timeline">
          <Timeline>
            <TimelineEvent at="Nov 13, 3:21 PM" title={<Verdict labelName="Marketing" disposition="archive" />}>
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
            <Figure label="Needs a look" value="2" note="in Activity" tone="failure" href="/system" />
          </Figures>
          <StackedBars
            compact
            series={SERIES}
            rows={DAYS}
            line={{ name: 'Model cost', values: [0.04, 0.02, 0.06, 0, 0.03, 0.08, 0.05], format: money, tick: moneyTick }}
          />
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
        </dl>
      </Section>

      <div className="grid gap-14 lg:grid-cols-2">
        <Section title="Settings in a sheet" meta="a settings page is groups: what each governs on the left, its sheet on the right">
          <SettingsGroup title="Active" note="Whether sift changes your Gmail.">
            <Sheet>
              <SettingRow title="Off" note="Nothing in Gmail changes. sift suggests, and learns from your answers.">
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
        <Section title="Empty and loading">
          <Empty>Nothing is waiting on you.</Empty>
          <Loading rows={3} />
        </Section>
        <Section title="Reserve" meta="holds the room for what arrives late, so nothing below moves">
          <Reserve id="specimen" ready={false} room={{ narrow: 96, wide: 96 }} placeholder={<Loading rows={2} />}>
            <span />
          </Reserve>
          <p className="text-muted-foreground">This line stays where it is when the part above fills in.</p>
        </Section>
      </div>

      <div className="grid gap-14 lg:grid-cols-2">
        <Section title="Toast" meta="what a press did, after the list moved on">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => toast('From now on, mail from news@example.com is Newsletters: archived.')}>Plain</Button>
            <Button onClick={() => toast('Put back in the inbox', { action: { label: 'Undo', onPress: () => toast('Archived again.') } })}>
              With an action
            </Button>
            <Button onClick={() => toast('Could not undo', { tone: 'failure', description: 'Gmail answered 503.' })}>Failure</Button>
          </div>
        </Section>
        <Section title="Menu, notice and hover card">
          <div className="flex flex-wrap items-center gap-6">
            <Menu
              label="Account, ada@example.org"
              trigger={<Avatar name="ada@example.org" />}
              heading={
                <>
                  <p className="text-muted-foreground">Signed in</p>
                  <p className="mt-1 font-medium">ada@example.org</p>
                </>
              }
              items={[
                { label: 'Sign out', onSelect: () => toast('Signed out.') },
                { label: 'Disabled', note: 'With the reason under it.', disabled: true, onSelect: () => {} },
              ]}
            />
            <Notice>Offline</Notice>
            <Notice tone="look" href="/system" action="Reconnect">
              Google sign-in expired
            </Notice>
            <p>
              Mail from{' '}
              <HoverCard
                href="/system"
                className="font-medium"
                card={
                  <div className="flex flex-col gap-2">
                    <p className="name">Example News</p>
                    <Facts>
                      <Fact term="Standing">
                        <Stamp>Trusted</Stamp>
                      </Fact>
                      <Fact term="Mail">42 messages</Fact>
                    </Facts>
                  </div>
                }
              >
                news@example.com
              </HoverCard>
            </p>
          </div>
        </Section>
      </div>

      <Section title="Navigation">
        <Sheet className="px-4">
          <Masthead
            current="system"
            items={[
              { to: 'system', label: 'Suggestions', count: 12 },
              { to: 'system/activity', label: 'Activity' },
              { to: 'system/rules', label: 'Rules' },
            ]}
            status={<Notice>Offline</Notice>}
            aside={<span>Synced just now</span>}
            account={{ name: 'ada@example.org', items: [{ label: 'Sign out', onSelect: () => toast('Signed out.') }] }}
          />
        </Sheet>
      </Section>

      <Section title="Document" meta="a page read from top to bottom: /terms, /privacy">
        <Sheet>
          <Document title="Terms of service" updated="November 15, 2026">
            <p>These terms are between you and whoever runs this copy of sift.</p>
            <Clause title="Your part">
              <ul>
                <li>Sign in only with a Gmail account that is yours.</li>
                <li>Check what sift suggests before turning it on.</li>
              </ul>
            </Clause>
          </Document>
        </Sheet>
      </Section>

      <Section title="Entry" meta="the page in place of the dashboard: signing in, then connecting a model; centred in the window">
        <div className="sheet [&>main]:min-h-0">
          <Entry account={{ name: 'me@example.org', onSettings: () => {}, onSignOut: () => {} }}>
            <p className="statement">Connect a model.</p>
            <p className="text-muted-foreground">It reads the mail no rule covers and says which of your labels it is.</p>
            <Field label="How far back" hint="Up to 300 messages, one model call each.">
              <Select label="How far back" value="7" options={[['7', 'The last week']] as const} onChange={() => {}} />
            </Field>
            <Button variant="mark" size="lg" className="justify-between">
              Continue
              <ArrowRightIcon aria-hidden />
            </Button>
          </Entry>
        </div>
      </Section>

      <Section title="Dialog and panel" meta="a form or a question; one item of a list">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog(true)}>Open a dialog</Button>
          <Button onClick={() => setPanel(true)}>Open the panel</Button>
        </div>
      </Section>

      <Section title="Note">
        <div className="grid gap-6 sm:grid-cols-3">
          <Note title="Plain">
            <p>Something worth knowing that needs nothing done.</p>
          </Note>
          <Note tone="look" title="Needs you">
            <p>Something only the reader can do.</p>
          </Note>
          <Note tone="failure" title="Failed">
            <p>What went wrong, and what to try.</p>
          </Note>
        </div>
      </Section>

      <Section title="Failure" meta="under what failed, or the word for a step that failed">
        <div className="flex flex-col gap-3">
          <Failure>Gmail refused the change. Nothing was moved.</Failure>
          <p>
            Archive in Gmail <Failure inline>Failed</Failure>
          </p>
        </div>
      </Section>

      <Section title="Copyable and disclosure">
        <div className="grid gap-6 sm:grid-cols-2">
          <Copyable value="sudo tailscale serve --bg 8787" label="command" />
          <Disclosure summary="What sift saw in it">
            <p>Shown only to the reader who went looking.</p>
          </Disclosure>
        </div>
      </Section>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Add a rule"
        footer={
          <>
            <Button variant="ink" onClick={() => setDialog(false)}>
              Add rule
            </Button>
            <Button variant="quiet" onClick={() => setDialog(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <Form onSubmit={() => setDialog(false)}>
          <Field label="Mail">
            <Input aria-label="Mail" className="w-full" placeholder="name@example.com" />
          </Field>
        </Form>
      </Dialog>
      <Panel
        open={panel}
        onClose={() => setPanel(false)}
        title="Five things to read"
        subtitle="Example Weekly · Nov 13, 3:21 PM"
        position="1 of 3"
        onNext={() => {}}
      >
        <p className="max-w-[68ch] text-reading leading-relaxed">
          The message on the left; on the right what sift said, the answer, the sender and the history.
        </p>
      </Panel>
    </main>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="row grid items-center gap-x-4 gap-y-2 px-4 py-4 sm:grid-cols-[8rem_1fr]">
      <p className="slug text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">{children}</div>
        {note ? <p className="text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}
