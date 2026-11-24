'use client';
import {
  ActivityIcon,
  ArchiveIcon,
  ArrowRightIcon,
  CircleHelpIcon,
  ListChecksIcon,
  MailIcon,
  MegaphoneIcon,
  PlusIcon,
  ReplyIcon,
  ShieldAlertIcon,
  SparkleIcon,
  TagIcon,
  Trash2Icon,
  WorkflowIcon,
  SquarePenIcon,
} from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { StatusWord, Verdict } from '@/components/bits.tsx';
import { ContactHint } from '@/components/sender.tsx';
import { SiftStatus, UsageDetail } from '@/components/status.tsx';
import { Mailbox } from '@/lib/narrowed.ts';
import { type Recipient, wrongAddresses } from '@/lib/addresses.ts';
import { ACTIONS, INBOX, INBOX_NAME, STATUS_NAMES, TIERS, inboxFirst, money, moneyTick, outcomeName } from '@/lib/format.ts';
import {
  Ago,
  Arrived,
  BarSlot,
  Heard,
  Heads,
  Blank,
  Does,
  LabelChip,
  LabelName,
  AnswerPicker,
  LabelPick,
  LabelSheet,
  ActionIcon,
  Avatar,
  Button,
  Check,
  ChoiceGroup,
  Code,
  ConfirmButton,
  DeleteButton,
  Ask,
  AttachButton,
  DiscardButton,
  type DraftFile,
  DraftFiles,
  MessageFiles,
  Recipients,
  Copyable,
  Dialog,
  Clause,
  Disclosure,
  DraftBlocked,
  DraftLine,
  DraftText,
  Document,
  Empty,
  Entry,
  Onboarding,
  Splash,
  Fact,
  Facts,
  Failure,
  Field,
  Finish,
  FieldGroup,
  Figure,
  Figures,
  FilterGroup,
  Cloud,
  FinePrint,
  Form,
  Highlight,
  HoverCard,
  Input,
  Kbd,
  ListPage,
  ListView,
  Hint,
  Look,
  Loading,
  LoadingBar,
  MailFrame,
  Quoted,
  Marked,
  MailboxSwitch,
  Masthead,
  TabBar,
  FloatingPress,
  Menu,
  Meter,
  Note,
  Callout,
  CalloutKey,
  Notice,
  OnPhone,
  PageFoot,
  PageHeader,
  Panel,
  Popover,
  AnswerRow,
  MessageHead,
  MessageStack,
  Presses,
  Reader,
  ReaderBar,
  ReplyBox,
  Rail,
  Reserve,
  Rope,
  RowActions,
  RowCheck,
  RowPresses,
  More,
  Pager,
  Section,
  Select,
  SomeOf,
  Share,
  SettingRow,
  SettingsGroup,
  Sheet,
  Spark,
  StackedBars,
  Sub,
  Swatch,
  Swipe,
  Table,
  Td,
  TextArea,
  TextLink,
  TextPress,
  Th,
  Timeline,
  TimelineEvent,
  Tooltip,
  Tr,
  TrGroup,
  useToast,
  Wordmark,
  Emblem,
} from '@/system';

const DAILY_COST = [
  0.11, 0.14, 0.09, 0.21, 0.12, 0.08, 0.04, 0.13, 0.16, 0.1, 0.12, 0.31, 0.15, 0.09, 0.05, 0.12, 0.14, 0.11, 0.18, 0.13, 0.07, 0.06, 0.15, 0.17, 0.12, 0.19,
  0.14, 0.11, 0.16, 0.14,
];
const SAVED_DAILY = [52, 61, 70, 22, 18, 64, 58, 49, 73, 60, 24, 15, 57, 71, 63, 66, 51, 20, 19, 62, 68, 75, 55, 59, 27, 18, 64, 72, 60, 52];
const SAVED = (messages: number) => ({ messages, seconds: messages * 10 });
const USAGE = {
  day: 0.14,
  week: 0.96,
  month: DAILY_COST.reduce((a, b) => a + b),
  daily: DAILY_COST,
  saved: {
    day: SAVED(52),
    week: SAVED(401),
    month: SAVED(SAVED_DAILY.reduce((a, b) => a + b)),
    daily: SAVED_DAILY.map((n) => n * 10),
    wouldHave: SAVED(0),
  },
};
const SYNCED = Date.now() - 20_000;
const SPECIMEN_ACCOUNTS = [
  { id: 'ada@example.org', email: 'ada@example.org', lastSyncedAt: SYNCED, primary: true, canSend: false, aliases: [], signInEnds: null },
];
const NAV = [
  { to: 'system', label: 'For review', icon: ListChecksIcon, count: 12 },
  { to: 'system/activity', label: 'Activity', icon: ActivityIcon },
  { to: 'system/labels', label: 'Labels', icon: TagIcon },
  { to: 'system/rules', label: 'Rules', icon: WorkflowIcon },
];
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
  [INBOX, INBOX_NAME],
  ['newsletter', 'Newsletters'],
  ['marketing', 'Marketing'],
  ['phishing', 'Scams and phishing'],
] as const;
const SHEET_LABELS = [
  [[INBOX, INBOX_NAME, 'keep']],
  [['marketing', 'Marketing', 'archive', 3]],
  [
    ['newsletter', 'Newsletters', 'archive'],
    ['receipts', 'Receipts and transactions', 'archive'],
    ['notifications', 'Notifications', 'archive'],
    ['alerts', 'Account alerts', 'keep'],
    ['outreach', 'Cold outreach', 'spam'],
    ['phishing', 'Scams and phishing', 'spam'],
  ],
] as const;
const ROWS = [
  { sender: 'Example Weekly', address: 'news@example.com', subject: 'Five things to read', label: 'Newsletters', does: 'archive' },
  { sender: 'Ada at Example', address: 'ada@example.org', subject: 'Dinner on Saturday?', label: INBOX_NAME, does: 'keep' },
  { sender: 'founder@example.net', address: 'founder@example.net', subject: 'Quick question', label: null, does: 'review' },
];

const INKS = [
  ['bg-background', 'background', 'The page.'],
  ['bg-popover', 'popover', 'What floats: a dialog, a menu, a failed toast.'],
  ['bg-foreground', 'foreground', 'Ink: text, the main action, and a toast.'],
  ['bg-supporting', 'supporting', 'What supports the text: a preview, a hint, Mild’s label.'],
  ['bg-faint', 'faint', 'What only places a row: when, an address, a count. A row’s quiet ink.'],
  ['bg-(--frame)', '--frame', 'A sheet’s edge.'],
  ['bg-(--rule)', '--rule', 'Lines between rows, dashed.'],
  ['bg-(--fill)', '--fill', 'What a control is filled with.'],
  ['bg-(--row-strong)', '--row', 'The row you are on: quieter than any control on it.'],
  ['bg-highlight', 'highlight', 'Look here. Nothing else is yellow.'],
  ['bg-destructive', 'destructive', 'A failure. Nothing else is red.'],
] as const;

const VARIANTS = [
  ['mark', 'What the screen is waiting on. One per screen, at most, never down a list.'],
  ['ink', 'What finishes a dialog or a form. Never down a list.'],
  ['plain', 'A page’s own action, and everything else said once.'],
  ['quiet', 'Repeated down a list (firmer when its row is pointed at), and ways out.'],
  ['danger', 'Deleting what nothing brings back, said once. Only DeleteButton draws it.'],
  ['destroy', 'The press that deletes, once asked. Only DeleteButton draws it.'],
] as const;

/** Every part of the design system in every state, at `/system`. Add to it when the system grows. */
export function SystemView() {
  const [choice, setChoice] = useState<(typeof ACTIONS)[number][0]>('archive');
  const [label, setLabel] = useState<string | null>('newsletter');
  const [waiting, setWaiting] = useState(false);
  const [standing, setStanding] = useState<string | null>(null);
  const [model, setModel] = useState<'small' | 'medium' | 'large'>('small');
  const [checked, setChecked] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [panel, setPanel] = useState(false);
  const [reading, setReading] = useState(false);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [made, setMade] = useState('');
  const [labelled, setLabelled] = useState('');
  const [offset, setOffset] = useState(0);
  const [mailbox, setMailbox] = useState('');
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState('all');
  const mailboxes = { mailboxes: ['ada@example.org', 'ada@work.example.org'], value: mailbox, onChange: setMailbox };
  const toast = useToast();
  const answer = () =>
    toast('Archive as Marketing', {
      undo: () => toast('Back in the inbox'),
      action: { label: 'Same for 2 more', onPress: () => toast('Archive as Marketing: 2 more') },
    });
  const account = {
    name: 'ada@example.org',
    items: [
      { label: 'Settings', onSelect: () => toast('Settings') },
      { label: 'Sign out', onSelect: () => toast('Signed out') },
    ],
  };
  return (
    // Its parts are shown as a service shows them, with the terms, privacy and security in the fine print.
    <Cloud value>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 py-8 md:px-6">
        <PageHeader title="Design system" meta="Every part, in every state. The rules for using them are in docs/design.md." />

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
            <Row label="emblem" note="The app’s icon, where the name has no room: the top of the rail.">
              <Emblem />
            </Row>
            <Row label="statement" note="A page’s title, and nothing else.">
              <p className="statement">For review</p>
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
                Text, 16px; 15px beside it. <span className="text-muted-foreground">Secondary text is lighter, not smaller.</span> A <Code>command</Code>{' '}
                inline, a <TextLink href="/system">link</TextLink>, a link to{' '}
                <TextLink href="https://example.com" away>
                  another site
                </TextLink>
                , a press <TextPress onPress={() => toast('Pressed')}>in a line</TextPress>, a key <Kbd>Enter</Kbd>.
              </p>
            </Row>
            <Row label="slug" note="A figure’s label. Not a heading, and not a column head, which is Th.">
              <p className="slug text-muted-foreground">Their next mail</p>
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
            <Row label="Ago" note="How long since, drawn only in the browser: the server's clock and zone are not the reader's.">
              <Ago at={SYNCED} />
            </Row>
            <Row label="Arrived" note="When mail came, under its period's TrGroup heading: the time of day until yesterday, then the weekday, then the date.">
              <p className="flex gap-4">
                <Arrived at={SYNCED} />
                <Arrived at={SYNCED - 3 * 86_400_000} />
                <Arrived at={SYNCED - 20 * 86_400_000} />
              </p>
            </Row>
            <Row
              label="Heard"
              note="When a message in a conversation came, in its head: the time today, then the day and the time, the year only when it is not this one."
            >
              <p className="flex gap-4">
                <Heard at={SYNCED} />
                <Heard at={SYNCED - 3 * 86_400_000} />
              </p>
            </Row>
            <Row label="Mild does" note="Its icon and its word, the same whether suggested, done or a setting. Never what comes with it.">
              {ACTIONS.map(([key]) => (
                <Does key={key} action={key}>
                  {outcomeName(key)}
                </Does>
              ))}
              <Does action="review">{outcomeName('review')}</Does>
            </Row>
            <Row label="undone" note="A change that was taken back, in a log.">
              <Does action="archive" struck>
                Archived
              </Does>
            </Row>
            <Row label="label" note="A label named in words: its tag, then its name, in the weight of the words around it. Everywhere a label is named.">
              <LabelName>Notifications</LabelName>
              <span className="font-medium">
                <LabelName>Receipts</LabelName>
              </span>
              <span className="text-muted-foreground">
                Mostly <LabelName>Newsletters</LabelName>
              </span>
            </Row>
            <Row label="label chip" note="A label as a thing of its own, where several sit in a row: what a press gave, what a change added or took off.">
              <LabelChip>Build results</LabelChip>
              <LabelChip>mild/newsletters</LabelChip>
            </Row>
            <Row label="verdict" note="What Mild says mail is and does: the action, then the label. At any size; a sender's next mail is a heading.">
              <Verdict labelId="newsletters" labelName="Newsletters" disposition="archive" />
              <Verdict labelId={null} labelName={null} disposition="review" />
              <p className="heading">
                <Verdict labelId="marketing" labelName="Marketing" disposition="archive" />
              </p>
            </Row>
            <Row
              label="meter"
              note="How sure Mild is about a label, in three steps. A suggestion's label is its answer button, meter first. Unlabelled keeps the bars' room, so a column of answers lines up."
            >
              <Meter level={1} />
              <Meter level={2} />
              <Meter level={3} />
              <span className="inline-flex flex-col gap-1">
                <span className="inline-flex items-baseline gap-2">
                  <Meter level={2} />
                  Newsletters
                </span>
                <span className="inline-flex items-baseline gap-2">
                  <Meter level={null} />
                  Unlabelled
                </span>
              </span>
              <Button>
                <Meter level={3} />
                Marketing
              </Button>
              <Button>
                <Meter level={1} />
                Receipts
              </Button>
            </Row>
            <Row label="status" note="Where a decision got to in Gmail. Pointing at a skip says why.">
              {(['suggested', 'done', 'undone', 'failed'] as const).map((s) => (
                <span key={s} className="text-muted-foreground">
                  {STATUS_NAMES[s]}
                </span>
              ))}
              <StatusWord row={{ carryOut: true, outcome: 'skipped', actionStatus: null, outcomeDetail: 'message is not in the inbox' }} />
            </Row>
            <Row label="hint" note="An icon after a name; pointing at it says what it means. Look is yellow.">
              <span className="flex items-center gap-2 font-medium">
                Store
                <Hint icon={SparkleIcon} says="The first time Mild has seen them" tone="look" />
              </span>
              <span className="flex items-center gap-2 font-medium">
                Deals
                <Hint icon={MegaphoneIcon} says="They write often and you have never written back" />
              </span>
              <span className="flex items-center gap-2 font-medium">
                Ada Lovelace
                <Hint icon={ReplyIcon} says="You have written to them" />
              </span>
            </Row>
            <Row label="hint, said" note="The icon with its words, where they are the point: under a sender's name on their own page.">
              <span className="text-muted-foreground">
                <Hint icon={SparkleIcon} says="The first time Mild has seen them" tone="look" said />
              </span>
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
            <Row label="Finish" note="The ink press that finishes what is written in a layer, with ⌘↵ or Ctrl ↵ from anywhere in it: the composer's Send.">
              <Finish onClick={() => toast('Lunch', { kind: 'Sent' })}>Send</Finish>
              <Finish disabled why="Say who it is to.">
                Send
              </Finish>
            </Row>
            <Row label="delete" note="Deleting what nothing brings back: its words in red, or a trash can down a list, and one question for every one.">
              <DeleteButton
                question="Remove this rule?"
                what="anyone at news.example.com"
                onDelete={async () => toast('Mail from news.example.com', { kind: 'Rule removed' })}
              >
                Remove
              </DeleteButton>
              <DeleteButton
                question="Remove this rule?"
                what="anyone at news.example.com"
                says="Its Gmail filter is taken out of Gmail too."
                icon={<Trash2Icon aria-hidden />}
                onDelete={async () => toast('Mail from news.example.com', { kind: 'Rule removed' })}
              >
                Remove
              </DeleteButton>
              <DeleteButton
                question="Delete your account?"
                action="Delete everything"
                typed="me@example.org"
                says="Mild stops reading every mailbox and deletes everything it recorded."
                onDelete={() => Promise.reject(new Error('Mild stopped answering, so this may not have been saved.'))}
              >
                Delete account
              </DeleteButton>
              <DeleteButton
                question="Remove me@example.org?"
                icon={<Trash2Icon aria-hidden />}
                disabled
                why="You cannot delete your only remaining mailbox."
                onDelete={async () => {}}
              >
                Remove
              </DeleteButton>
            </Row>
            <Row label="confirm" note="A press that is hard to take back, but deletes nothing, asks first, in place.">
              <ConfirmButton variant="plain" question="Archive, label and mark spam on new mail by itself?" onConfirm={() => toast('Mild is on')}>
                Turn on
              </ConfirmButton>
            </Row>
            <Row label="ask" note="A press that asks only when what it acts on needs it: Send, on mail with no subject.">
              <Ask question="Send without a subject?" onYes={() => toast('Sends it')} onNo={() => toast('Back to writing')}>
                Send
              </Ask>
            </Row>
          </Sheet>
        </Section>

        <Section title="Controls">
          <Sheet>
            <Row label="select" note="A short list.">
              <Select label="What Mild does" value={choice} options={ACTIONS} onChange={setChoice} />
              <Select
                label="With icons"
                value={choice}
                options={ACTIONS}
                icons={Object.fromEntries(ACTIONS.map(([key]) => [key, <ActionIcon key={key} action={key} />]))}
                onChange={setChoice}
              />
              <Select label="Disabled" value={choice} options={ACTIONS} onChange={setChoice} disabled />
            </Row>
            <Row label="select, set apart" note="A rule between choices that are not of a kind: Leave in inbox first, the labels, then no label at all.">
              <Select label="Label as" value={labelled} options={[...inboxFirst(LABELS), null, ['', 'No label, just act']]} onChange={setLabelled} />
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
              <ChoiceGroup label="What this is" value={label} options={LABELS} onChange={setLabel} />
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
            <Row label="choice rows" note="With notes, each choice is a row saying what sets it apart, ticked when on.">
              <div className="w-full max-w-md">
                <ChoiceGroup
                  label="Model"
                  value={model}
                  options={[
                    ['small', 'example-small'],
                    ['medium', 'example-medium'],
                    ['large', 'example-large'],
                  ]}
                  notes={{
                    small: 'Recommended · about $0.38 per 1,000 messages',
                    medium: 'About $3.75 per 1,000 messages',
                    large: 'About $15.00 per 1,000 messages',
                  }}
                  onChange={(next) => next && setModel(next)}
                />
              </div>
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

        <Section title="FieldGroup" meta="a long form in parts, each under its name">
          <div className="max-w-xl">
            <Form onSubmit={() => {}}>
              <FieldGroup title="Which mail">
                <Field inline label="Sender">
                  <Input aria-label="Sender" className="w-full" defaultValue="example.com" />
                </Field>
              </FieldGroup>
              <FieldGroup title="What happens">
                <Field inline label="Then">
                  <Select label="Then" value={choice} options={ACTIONS} onChange={setChoice} />
                </Field>
              </FieldGroup>
            </Form>
          </div>
        </Section>

        <Section title="Form" meta="fields, one under another, the action last">
          <div className="grid gap-10 md:grid-cols-2">
            <Form onSubmit={() => toast('Saved')}>
              <Field label="Name" hint="In Gmail it stays mild/newsletters.">
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

        <Section title="Page header and section" meta="the top of a page about one thing, and the parts under it; the second narrowed to one mailbox">
          <Sheet className="gap-8 p-5">
            <PageHeader title="Ada Lovelace" meta="ada@example.org" actions={<Button>Write to them</Button>} />
            <Mailbox value="ada@work.example.org">
              <PageHeader title="news.example.com" />
            </Mailbox>
            <Section title="Proposed rules" meta="2" action={<TextLink href="/system">See all</TextLink>}>
              <p className="text-muted-foreground">A section’s content. No rule or box sets it apart, only space.</p>
            </Section>
          </Sheet>
        </Section>

        <Section
          title="List page, list view"
          meta="how every screen shows many of one thing: the page drawn on the server, the list in it; on a desktop the rail names it, and its action ends the bar"
        >
          <Sheet className="p-5">
            <ListPage title="For review">
              <ListView
                search={{ value: search, onChange: setSearch, placeholder: 'Search' }}
                filters={{
                  active: made === '' ? [] : [{ label: `Then: ${outcomeName(made)}`, clear: () => setMade('') }],
                  panel: (
                    <>
                      <FilterGroup label="Label" value={labelled} options={[['', 'Any'], null, ...inboxFirst(LABELS)]} onChange={setLabelled} />
                      <FilterGroup label="Then" value={made} options={[['', 'Anything'], ...ACTIONS]} onChange={setMade} />
                    </>
                  ),
                }}
              >
                <Table keys>
                  <Heads>
                    <Th>Sender</Th>
                    <Th phone="hide">Subject</Th>
                    <Th>Label</Th>
                  </Heads>
                  <tbody>
                    {ROWS.filter(
                      (row) => (made === '' || row.does === made) && `${row.sender} ${row.subject}`.toLowerCase().includes(search.toLowerCase()),
                    ).map((row) => (
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
                              LABELS.slice(0, 1).map(([id, name]) => ({ id, label: name, ...(row.does === 'keep' ? { lead: <Meter level={3} /> } : {}) })),
                              LABELS.slice(1, 3).map(([id, name], i) => ({ id, label: name, lead: <Meter level={i === 0 ? 3 : 1} /> })),
                              LABELS.slice(3).map(([id, name]) => ({ id, label: name })),
                            ]}
                            empty={outcomeName('review')}
                            ending={{ onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') }}
                            onSubmit={(id) => toast(`Answered: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`)}
                          />
                        </RowActions>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager offset={offset} size={50} total={120} onGo={setOffset} />
              </ListView>
            </ListPage>
          </Sheet>
          <p className="text-muted-foreground">
            On a phone the table keeps its first column; what the others said moves under it, and the row opens for the rest.
          </p>
          <Sheet className="p-5">
            <Mailbox value="ada@work.example.org">
              <ListPage
                title="Labels"
                actions={
                  <Button>
                    <PlusIcon aria-hidden />
                    Add labels
                  </Button>
                }
              >
                <ListView>
                  <p className="text-muted-foreground">A list with no search: the mailbox and the action on a line of their own over it.</p>
                </ListView>
              </ListPage>
            </Mailbox>
          </Sheet>
        </Section>

        <Section title="A log" meta="a few ways to see the list; one table, a heading for each day">
          <Sheet className="p-5">
            <ListPage title="Activity">
              <ListView
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
                  <Heads>
                    <Th>Sender</Th>
                    <Th phone="hide">Subject</Th>
                    <Th phone="hide">What happened</Th>
                  </Heads>
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
            </ListPage>
          </Sheet>
        </Section>

        <Section
          title="Rows to select"
          meta="dense: a line of small type each; a check on each row (X on the one the keys are on), which fills it; what to do with them takes the search's place; pointed at, a row's presses take its time's place; more rows load as the end is reached; words typed can be asked"
        >
          <Sheet className="p-5">
            <ListPage title="Inbox">
              <ListView
                search={{
                  value: search,
                  onChange: setSearch,
                  placeholder: 'Search',
                  ask: { onAsk: () => toast('Asks the model to make filters of the words'), busy: false },
                }}
                selected={{
                  count: picked.size,
                  clear: () => setPicked(new Set()),
                  actions: [
                    { label: 'Archive', key: 'e', onPress: () => toast(`Archived ${picked.size}`) },
                    { label: 'Mark read', key: 'Shift+i', onPress: () => toast(`Marked ${picked.size} read`) },
                  ],
                }}
              >
                <Table keys dense>
                  <Heads>
                    <Th phone="hide">Select</Th>
                    <Th>From</Th>
                    <Th phone="hide">Subject</Th>
                    <Th phone="hide">Received</Th>
                  </Heads>
                  <tbody>
                    {ROWS.map((row, index) => (
                      <Tr key={row.address} selected={picked.has(row.address)} onOpen={() => setPanel(true)}>
                        <RowCheck
                          label={`Select ${row.subject}`}
                          checked={picked.has(row.address)}
                          onChange={(on) => setPicked((was) => new Set(on ? [...was, row.address] : [...was].filter((a) => a !== row.address)))}
                        />
                        <Td className="max-w-0 md:w-1/3">
                          <span className="name block truncate">{row.sender}</span>
                        </Td>
                        <Td phone="hide" className="max-w-0 md:w-full">
                          <span className="block truncate">{row.subject}</span>
                        </Td>
                        <RowPresses
                          lead={
                            <LabelPick
                              label={`What ${row.subject} is`}
                              value={row.label === null ? null : (LABELS.find(([, name]) => name === row.label)?.[0] ?? null)}
                              groups={[
                                LABELS.slice(0, 1).map(([id, name]) => ({ id, label: name })),
                                LABELS.slice(1, 2).map(([id, name]) => ({ id, label: name, lead: <Meter level={3} /> })),
                                LABELS.slice(2).map(([id, name]) => ({ id, label: name })),
                              ]}
                              onSubmit={async (id) => toast(`Saved: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`)}
                              ending={{ onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') }}
                            />
                          }
                          mark={row.label === null ? <Hint icon={CircleHelpIcon} says="Unlabelled" tone="look" /> : null}
                          presses={
                            <>
                              <Tooltip says="Archive">
                                <Button variant="bare" size="tray" aria-label="Archive" onClick={() => toast(`Archived ${row.subject}`)}>
                                  <ArchiveIcon aria-hidden />
                                </Button>
                              </Tooltip>
                              <Tooltip says="Spam">
                                <Button variant="bare" size="tray" aria-label="Spam" onClick={() => toast(`Marked ${row.subject} as spam`)}>
                                  <ShieldAlertIcon aria-hidden />
                                </Button>
                              </Tooltip>
                            </>
                          }
                        >
                          {`${9 - index}:12 AM`}
                        </RowPresses>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <More onReach={() => {}} />
              </ListView>
            </ListPage>
          </Sheet>
        </Section>

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

        <div className="grid gap-14 lg:grid-cols-2">
          <Section title="Toast" meta="what a press did, after the list moved on: one line, the newest replacing the last">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => toast('12 messages pulled in', { description: 'They show under For review as Mild decides them.' })}>A result</Button>
              <Button onClick={answer}>With Undo</Button>
              <Button
                onClick={() =>
                  toast('Mail from notifications@code.example.com: send it to spam', {
                    kind: 'Rule added',
                    action: { label: 'Apply to inbox…', onPress: () => toast('Applied to 3 messages') },
                    undo: () => toast('Rule taken back'),
                  })
                }
              >
                With a kind
              </Button>
              <Button onClick={() => toast('Could not undo', { tone: 'failure', description: 'Gmail answered 503.' })}>Failure</Button>
              <Button
                onClick={() => {
                  toast('Could not undo', { tone: 'failure', description: 'Gmail answered 503.' });
                  toast('Mail from deals@example.com: archive it', { kind: 'Rule added' });
                  answer();
                }}
              >
                Several at once
              </Button>
            </div>
          </Section>
          <Section title="Toast, saying what a press did" meta="the mail it was done to, then what was done and the label it gave">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  [
                    'Archive, labelled',
                    'Dependabot: bump lodash to 4.17.21',
                    [
                      { action: 'archive', word: 'Archived' },
                      { action: 'label', word: 'Notifications' },
                    ],
                  ],
                  [
                    'To the digest',
                    '3 conversations',
                    [
                      { action: 'archive', word: 'Archived' },
                      { action: 'label', word: 'Build results' },
                      { action: 'digest', word: 'In the digest' },
                    ],
                  ],
                  [
                    'Answered, kept',
                    'Your electricity bill for November',
                    [
                      { action: 'keep', word: 'Kept' },
                      { action: 'label', word: 'Receipts' },
                    ],
                  ],
                  [
                    'Block',
                    '48 hours only: 30% off',
                    [
                      { action: 'block', word: 'Blocked deals@shop.example.com' },
                      { action: 'label', word: 'Cold outreach' },
                    ],
                  ],
                  ['No label', 'Lunch on Thursday?', [{ action: 'archive', word: 'Archived' }]],
                ] as const
              ).map(([press, subject, did]) => (
                <Button key={press} onClick={() => toast(subject, { did, undo: () => toast('Back in the inbox') })}>
                  {press}
                </Button>
              ))}
              <Button
                onClick={() =>
                  toast('Disk 91% full on db-2', {
                    did: [
                      { action: 'archive', word: 'Archived' },
                      { action: 'label', word: 'Notifications' },
                    ],
                    action: { label: 'Same for 2 more', onPress: () => toast('2 messages', { did: [{ action: 'archive', word: 'Archived' }] }) },
                    undo: () => toast('Back in the inbox'),
                  })
                }
              >
                With more alike
              </Button>
            </div>
          </Section>
          <Section title="Menu, popover, notice and hover card">
            <div className="flex flex-wrap items-center gap-6">
              <Popover label="Why">
                <p>Your answer. Mild said: a bill from a utility you pay.</p>
                <p>A card under the press on a desktop; a sheet up from the bottom on a phone.</p>
              </Popover>
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
                  { label: 'Sign out', onSelect: () => toast('Signed out') },
                  { label: 'Disabled', note: 'With the reason under it.', disabled: true, onSelect: () => {} },
                ]}
              />
              <Menu
                label="Show"
                trigger={<span className="flex h-(--control) items-center px-2 font-semibold">Views, the one showing ticked</span>}
                items={[
                  ['all', 'Everything'],
                  ['needs', 'Needs you'],
                  ['sorted', 'Sorted'],
                ].map(([key, text]) => ({ label: text, on: key === view, onSelect: () => setView(key) }))}
              />
              <Notice>Mild cannot be reached</Notice>
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
                      <p className="flex items-center gap-2">
                        <span className="name">Example News</span>
                        <ContactHint contact="one-way" />
                      </p>
                      <Facts>
                        <Fact term="Mail">42 messages</Fact>
                      </Facts>
                    </div>
                  }
                >
                  news@example.com
                </HoverCard>
              </p>
              <p>
                <HoverCard
                  card={
                    <div className="flex flex-col gap-3">
                      <div>
                        <TextLink href="/system" className="name block">
                          Example News
                        </TextLink>
                        <p className="text-muted-foreground">news@example.com</p>
                      </div>
                      <ul className="flex flex-col gap-1">
                        <li>42 messages since Mar 3, 2026</li>
                        <li>Mostly Newsletters</li>
                      </ul>
                    </div>
                  }
                >
                  Example News
                </HoverCard>
                , in a row that opens something else
              </p>
              <p>
                Synced{' '}
                <Tooltip says="Nov 13, 2026, 3:21 PM" className="text-muted-foreground">
                  11 h ago
                </Tooltip>
              </p>
            </div>
          </Section>
        </div>

        <Section title="Column heads" meta="shown where a figure would not say what it is without one">
          <Table>
            <Heads shown="wide">
              <Th>
                <span className="sr-only">Rule</span>
              </Th>
              <Th phone="hide" num says="Messages the rule has decided since it was made">
                Decisions
              </Th>
              <Th phone="hide" num>
                Last used
              </Th>
              <Th phone="hide" num>
                Cost 30D
              </Th>
            </Heads>
            <tbody>
              <Tr>
                <Td className="max-w-0 md:w-full">
                  <span className="name">news@example.com</span>
                </Td>
                <Td phone="hide" num>
                  4
                </Td>
                <Td phone="hide" num quiet says="Nov 17, 2026, 10:42 AM">
                  6 min ago
                </Td>
                <Td phone="hide" num says="31 messages checked">
                  $0.42
                </Td>
              </Tr>
            </tbody>
          </Table>
        </Section>

        <Section
          title="Navigation"
          meta="the rail on a desktop; on a phone the masthead, the tab bar and a screen's floating press; the mailbox switch in each, for someone with more than one"
        >
          <div className="hidden gap-6 md:flex">
            <Sheet className="flex h-[38rem]">
              <Rail
                current="system"
                items={NAV}
                aside={<SiftStatus accounts={SPECIMEN_ACCOUNTS} usage={USAGE} plan={null} stacked />}
                mailbox={mailboxes}
                account={account}
                compose={() => {}}
              />
            </Sheet>
            <Sheet className="flex h-[38rem]">
              <Rail current="" items={[]} />
            </Sheet>
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <div className="w-72">
              <MailboxSwitch {...mailboxes} />
            </div>
          </div>
          <div className="flex flex-col gap-6 md:hidden">
            <Sheet className="px-4">
              <Masthead
                current="system"
                items={NAV}
                aside={<SiftStatus accounts={SPECIMEN_ACCOUNTS} usage={USAGE} plan={null} />}
                detail={<UsageDetail usage={USAGE} plan={null} />}
                mailbox={mailboxes}
                account={account}
                slot={setBar}
              />
              {/* A list's search goes up into the bar. */}
              <BarSlot value={bar}>
                <ListView search={{ value: search, onChange: setSearch, placeholder: 'Search mail' }} filters={{ active: [], panel: null }}>
                  {null}
                </ListView>
              </BarSlot>
            </Sheet>
            <Sheet className="px-4">
              <Masthead current="" items={[]} />
            </Sheet>
            {/* Both are fixed to the foot of the screen, as they are on every phone screen. */}
            <TabBar current="system" items={NAV} />
            <FloatingPress label="Compose" icon={<SquarePenIcon aria-hidden />} onPress={() => {}} />
          </div>
        </Section>

        <Section title="Document" meta="a page read from top to bottom: /terms, /privacy, /security">
          <Sheet>
            <Document title="Terms of service" updated="November 15, 2026">
              <p>These terms are between you and whoever runs this copy of Mild.</p>
              <Clause title="Your part">
                <ul>
                  <li>Sign in only with a Gmail account that is yours.</li>
                  <li>Check what Mild suggests before turning it on.</li>
                </ul>
              </Clause>
            </Document>
          </Sheet>
        </Section>

        <Section
          title="FinePrint, PageFoot"
          meta="the terms, privacy and security, on a Mild run as a service: at the foot of every dashboard screen, under the sections in the phone menu, under Splash and Entry"
        >
          <p className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
            <FinePrint />
          </p>
          <FinePrint list />
          <PageFoot />
          <p className="slug text-muted-foreground">Someone's own copy: only the code</p>
          <Cloud value={false}>
            <PageFoot />
          </Cloud>
        </Section>

        <Section title="Entry" meta="the page in place of the dashboard when sign-in cannot start here; centred in the window">
          <div className="sheet [&>main]:min-h-0">
            <Entry>
              <p className="statement">Sign-in is not set up.</p>
              <p className="text-muted-foreground">Mild needs a Google client before anyone can sign in.</p>
              <Button variant="mark" size="lg" className="justify-between">
                Continue
                <ArrowRightIcon aria-hidden />
              </Button>
            </Entry>
          </div>
        </Section>

        <Section title="Onboarding" meta="the page in place of the dashboard while someone sets Mild up: the steps, then the step, centred; scrolls when long">
          <div className="sheet [&>div]:min-h-0">
            <Onboarding
              steps={['Connect a model', 'What you want', 'Your labels', 'Older mail']}
              current={1}
              title="What do you want from Mild?"
              intro="Say it in your own words, and Mild suggests labels for it."
              account={{ name: 'me@example.org', onSettings: () => {}, onSignOut: () => {} }}
            >
              <TextArea aria-label="What do you want from Mild?" className="min-h-24" defaultValue="Get sales pitches out of my inbox." />
              <div>
                <Button variant="mark" size="lg">
                  Suggest labels
                  <ArrowRightIcon aria-hidden />
                </Button>
              </div>
            </Onboarding>
          </div>
        </Section>

        <Section title="Splash" meta="the first page of someone not signed in: the name, one line set large, the one action">
          <div className="sheet [&>div]:min-h-0">
            <Splash title="Your inbox, without the pesky salespeople." art={<Rope queue={6} />}>
              <Button variant="mark" size="lg" className="self-start">
                Sign in with Google
              </Button>
            </Splash>
          </div>
        </Section>

        <Section title="Reader" meta="a message opened from a list, in the list's place: its bar, Mild's row, the conversation and a reply in place">
          {reading ? (
            <SpecimenReader onBack={() => setReading(false)} />
          ) : (
            <div>
              <Button onClick={() => setReading(true)}>Open a message</Button>
            </div>
          )}
        </Section>

        <Section title="Mail frame" meta="a message as its own HTML, in the reader; this one has nothing to load, so it scrolls in a frame of its own">
          <MailFrame title="An empty message" />
        </Section>

        <Section title="Quoted" meta="the history a reply quotes, in a message’s text, folded">
          <p className="text-reading leading-relaxed">See you at noon.</p>
          <Quoted>
            <p className="text-reading leading-relaxed whitespace-pre-wrap">{'On Mon, Ada wrote:\n> Lunch on Thursday?'}</p>
          </Quoted>
        </Section>

        <Section title="Dialog and panel" meta="a form or a question; one item of a list">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialog(true)}>Open a dialog</Button>
            <Button onClick={() => setPanel(true)}>Open the panel</Button>
          </div>
        </Section>

        <Section title="Callout" meta="first on a page whose rows read differently in the state Mild is in">
          <Callout title="Mild is off" action={<Button href="#system">Turn Mild on…</Button>}>
            <p>What the state means for everything below it, said once.</p>
            <CalloutKey mark={<Meter level={3} />}>What a mark in the rows means.</CalloutKey>
            <CalloutKey mark={<Meter level={2} />}>And the others.</CalloutKey>
          </Callout>
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

        <Section title="Failure" meta="under the press that failed">
          <Failure>Could not save the label: that name is taken.</Failure>
        </Section>

        <Section title="SomeOf" meta="a list said in a line, folded past a few">
          <div className="grid gap-6 text-sm text-muted-foreground sm:grid-cols-2">
            <p>
              To <SomeOf items={['ada@example.org', 'grace@example.net', 'me@example.org', 'alan@example.com']} />
            </p>
            <p>
              Cc <SomeOf items={Array.from({ length: 40 }, (_, i) => `member${i + 1}@list.example.org`)} />
            </p>
          </div>
        </Section>

        <Section title="Copyable and disclosure">
          <div className="grid gap-6 sm:grid-cols-2">
            <Copyable value="sudo tailscale serve --bg 8787" label="command" />
            <Disclosure summary="What Mild saw in it">
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
          title="Mail from news@example.com"
          subtitle="Archive as Newsletters"
          position="1 of 3"
          onNext={() => {}}
          actions={
            <>
              <Button>Change…</Button>
              <span className="ml-auto">
                <DeleteButton question="Remove this rule?" onDelete={async () => setPanel(false)}>
                  Remove
                </DeleteButton>
              </span>
            </>
          }
        >
          <p className="max-w-[68ch] text-reading leading-relaxed">
            One item of a list: a rule, a label, Settings. A message opens in the list’s place instead.
          </p>
        </Panel>
      </main>
    </Cloud>
  );
}

const THREAD = [
  { id: 'a', from: 'Ada Lovelace', address: 'ada@example.org', preview: 'Are you free for lunch on Thursday?', at: 'Nov 10' },
  { id: 'b', from: 'me', address: 'me@example.org', preview: 'Thursday works. Noon at the usual place?', at: 'Nov 10' },
  { id: 'c', from: 'Ada Lovelace', address: 'ada@example.org', preview: 'Can Grace come too?', at: 'Nov 11' },
  { id: 'd', from: 'me', address: 'me@example.org', preview: 'Of course.', at: 'Nov 11' },
  { id: 'e', from: 'Grace Hopper', address: 'grace@example.net', preview: 'Count me in. I will bring the notes from the review.', at: 'Nov 11' },
  { id: 'f', from: 'me', address: 'me@example.org', preview: 'See you both there.', at: 'Nov 12' },
  { id: 'g', from: 'Ada Lovelace', address: 'ada@example.org', preview: 'Noon it is. I will bring the plans.', at: '9:41 AM' },
];
const NEWEST = THREAD[THREAD.length - 1];

/**
 * The reader as Inbox opens a conversation, its middle folded, or (For review) one message with what Mild said beside
 * it. Answering an earlier message opens the reply box at the foot, saying which it answers.
 */
function SpecimenReader({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState<'inbox' | 'review'>('inbox');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set([NEWEST.id]));
  const [replying, setReplying] = useState<{ title: string; to: (typeof THREAD)[number] } | null>(null);
  const [sending, setSending] = useState<'allowed' | 'not yet'>('allowed');
  const inbox = from === 'inbox';
  const groups = [
    LABELS.slice(0, 1).map(([id, name]) => ({ id, label: name, lead: <Meter level={2} /> })),
    LABELS.slice(1).map(([id, name]) => ({ id, label: name })),
  ];
  const said = <p>A reply in a thread you wrote in.</p>;
  const toggle = (id: string) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
  };
  const answer = (title: string, to: (typeof THREAD)[number] = NEWEST) => setReplying({ title, to });
  return (
    <div className="flex flex-col gap-6">
      <ChoiceGroup
        label="Sending"
        value={sending}
        options={[
          ['allowed', 'Allowed'],
          ['not yet', 'Not yet'],
        ]}
        onChange={(next) => next && setSending(next)}
      />
      <ChoiceGroup
        label="Opened from"
        value={from}
        options={[
          ['inbox', 'Inbox'],
          ['review', 'For review'],
        ]}
        onChange={(next) => next && setFrom(next)}
      />
      <Reader
        bar={
          <ReaderBar
            back={inbox ? 'Inbox' : 'For review'}
            onBack={onBack}
            presses={
              inbox
                ? [
                    { label: 'Archive', key: 'e', icon: <ArchiveIcon aria-hidden />, onPress: () => toast('Archived') },
                    { label: 'Mark unread', key: 'Shift+u', icon: <MailIcon aria-hidden />, onPress: () => toast('Marked unread') },
                  ]
                : []
            }
            label={
              inbox ? (
                <>
                  <LabelPick
                    size="toolbar"
                    label="What this message is"
                    value={INBOX}
                    groups={groups}
                    onSubmit={async (id) => toast(`Answered: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`)}
                    ending={{ onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') }}
                  />
                  <Popover label="Why">{said}</Popover>
                </>
              ) : undefined
            }
            position="2 of 3"
            onPrevious={() => toast('The one before')}
            onNext={() => toast('The one after')}
          />
        }
        thumbs={
          inbox && !replying
            ? [
                { label: 'Archive', icon: <ArchiveIcon aria-hidden />, onPress: () => toast('Archived') },
                { label: 'Unread', icon: <MailIcon aria-hidden />, onPress: () => toast('Marked unread') },
                { label: 'Reply', icon: <ReplyIcon aria-hidden />, onPress: () => answer('Reply') },
              ]
            : []
        }
        title="Lunch on Thursday?"
        answer={
          inbox ? undefined : (
            <AnswerRow
              key={from}
              picker={{
                label: 'What this message is',
                value: INBOX,
                groups,
                empty: outcomeName('review'),
                onSubmit: (id) => toast(`Answered: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`),
                ending: { onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') },
              }}
              why={said}
              whyOpen
            />
          )
        }
        side={
          inbox ? undefined : (
            <Section title="Sender">
              <Facts>
                <Fact term="Mail">14 messages since Oct 20, 2026</Fact>
                <Fact term="You wrote">Last week</Fact>
              </Facts>
            </Section>
          )
        }
      >
        <MessageStack messages={(inbox ? THREAD : [NEWEST]).map((m) => ({ ...m, unread: m.id === 'f' }))} open={open} onToggle={toggle}>
          {(id) => {
            const m = THREAD.find((one) => one.id === id) ?? NEWEST;
            return (
              <>
                <MessageHead
                  from={m.from === 'me' ? 'me' : <TextLink href="/system">{m.from}</TextLink>}
                  {...(m.from === 'me' ? {} : { address: m.address })}
                  at={m.at.includes(':') ? m.at : `${m.at}, 9:41 AM`}
                  to={[{ label: 'To', who: <SomeOf items={['me', 'grace@example.net']} /> }]}
                  {...(inbox
                    ? {
                        answers: {
                          reply: () => answer('Reply', m),
                          all: () => answer('Reply to all', m),
                          forward: () => answer('Forward', m),
                        },
                      }
                    : {})}
                  more={[{ label: 'Show as text', onSelect: () => toast('Shows its text') }]}
                />
                <div className="flex min-w-0 flex-col gap-3">
                  <p className="text-reading leading-relaxed">{m.preview}</p>
                  {m === NEWEST ? (
                    <Quoted>
                      <p className="text-reading leading-relaxed whitespace-pre-wrap">{'On Nov 12, me wrote:\n> See you both there.'}</p>
                    </Quoted>
                  ) : null}
                </div>
                {m === NEWEST ? (
                  // The second is being fetched from Gmail.
                  <MessageFiles
                    files={[
                      { key: '1', name: 'Thursday menu.pdf', size: 182_400 },
                      { key: '2', name: 'Directions to the restaurant from the station.png', size: 2_310_000, saving: true },
                    ]}
                    onSave={(key) => toast(key === '1' ? 'Saves Thursday menu.pdf' : 'Saving…')}
                  />
                ) : null}
              </>
            );
          }}
        </MessageStack>
        {!inbox ? null : replying ? (
          <ReplyBox
            key={`${replying.title}/${replying.to.id}`}
            label={replying.title}
            menu={
              <Menu
                label={`${replying.title}: change it`}
                trigger={<span className="flex h-(--control) items-center px-1.5 font-semibold text-foreground">{replying.title}</span>}
                items={(['Reply', 'Reply to all', 'Forward'] as const).map((title) => ({
                  label: title,
                  on: title === replying.title,
                  onSelect: () => answer(title),
                }))}
              />
            }
            {...(replying.to === NEWEST
              ? {}
              : {
                  about:
                    replying.title === 'Forward'
                      ? `Forwarding ${replying.to.from}’s message, ${replying.to.at}`
                      : `Replying to ${replying.to.from}, ${replying.to.at}`,
                })}
            actions={
              sending === 'allowed' ? (
                <>
                  <Finish onClick={() => setReplying(null)}>Send</Finish>
                  <AttachButton onFiles={(files) => toast(`Attaches ${files.length === 1 ? files[0].name : `${files.length} files`}`)} />
                  <DiscardButton onClick={() => setReplying(null)} />
                </>
              ) : (
                <>
                  <Button variant="mark" onClick={() => setSending('allowed')}>
                    Let Mild send
                  </Button>
                  <Button variant="quiet" onClick={() => setReplying(null)}>
                    Not now
                  </Button>
                </>
              )
            }
          >
            {sending === 'allowed' ? (
              <SpecimenDraft to={replying.title === 'Forward' ? [] : [{ address: replying.to.address, name: replying.to.from }]} />
            ) : (
              <DraftBlocked title="Mild can’t send from ada@example.org yet">Google asks you once before Mild can send as you.</DraftBlocked>
            )}
          </ReplyBox>
        ) : (
          <div className="phone:hidden">
            <Presses
              presses={[
                { label: 'Reply', key: 'r', onPress: () => answer('Reply') },
                { label: 'Reply all', key: 'a', onPress: () => answer('Reply to all') },
                { label: 'Forward', key: 'f', onPress: () => answer('Forward') },
              ]}
            />
          </div>
        )}
      </Reader>
    </div>
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

const PEOPLE = [
  { address: 'ada@example.org', name: 'Ada Lovelace' },
  { address: 'grace@example.org', name: 'Grace Hopper' },
  { address: 'alan@example.com', name: 'Alan Turing' },
  { address: 'billing@example.com' },
];

/** The composer's suggestions, from a few people: whose name or address has a word starting as typed. */
const suggestPeople = async (typed: string) => {
  const words = typed.toLowerCase().split(/\W+/).filter(Boolean);
  return PEOPLE.filter((p) =>
    words.every((w) =>
      `${p.name ?? ''} ${p.address}`
        .toLowerCase()
        .split(/\W+/)
        .some((v) => v.startsWith(w)),
    ),
  );
};

/** A draft's lines as the composer draws them: To with a chip and a wrong one, Cc and Bcc behind their presses, and files in each state. */
function SpecimenDraft({ to: start }: { to: Recipient[] }) {
  const [to, setTo] = useState<Recipient[]>([...start, { address: 'not an address', wrong: true }]);
  const [cc, setCc] = useState<Recipient[] | null>(null);
  const [bcc, setBcc] = useState<Recipient[] | null>(null);
  const [typing, setTyping] = useState({ to: '', cc: '', bcc: '' });
  const typed = (line: 'to' | 'cc' | 'bcc') => ({ text: typing[line], onText: (text: string) => setTyping((was) => ({ ...was, [line]: text })) });
  const [files, setFiles] = useState<DraftFile[]>([
    { key: 'plans', name: 'Roof plans.pdf', size: 2_400_000 },
    { key: 'photo', name: 'IMG_2041.jpg', size: 6_100_000, sent: 2_440_000 },
    { key: 'scan', name: 'Scan.tiff', size: 31_000_000, failed: 'Scan.tiff is larger than the 25 MB Gmail sends.' },
  ]);
  const wrong = (list: Recipient[]) => wrongAddresses(list.filter((r) => r.wrong).map((r) => r.address));
  return (
    <>
      <DraftLine label="To" error={wrong(to)}>
        <Recipients label="To" value={to} onChange={setTo} {...typed('to')} suggest={suggestPeople} />
        {cc ? null : (
          <Button variant="quiet" onClick={() => setCc([])}>
            Cc
          </Button>
        )}
        {bcc ? null : (
          <Button variant="quiet" onClick={() => setBcc([])}>
            Bcc
          </Button>
        )}
      </DraftLine>
      {cc ? (
        <DraftLine label="Cc">
          <Recipients label="Cc" value={cc} onChange={setCc} {...typed('cc')} suggest={suggestPeople} />
        </DraftLine>
      ) : null}
      {bcc ? (
        <DraftLine label="Bcc">
          <Recipients label="Bcc" value={bcc} onChange={setBcc} {...typed('bcc')} suggest={suggestPeople} />
        </DraftLine>
      ) : null}
      <DraftText aria-label="Message" className="min-h-48" />
      <DraftFiles files={files} onRemove={(key) => setFiles((all) => all.filter((f) => f.key !== key))} />
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
