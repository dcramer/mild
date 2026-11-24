'use client';
import { MegaphoneIcon, ReplyIcon, SparkleIcon } from 'lucide-react';
import { StatusWord, Verdict } from '@/components/bits.tsx';
import { ACTIONS, STATUS_NAMES, outcomeName } from '@/lib/words.ts';
import {
  Ago,
  Arrived,
  Heard,
  Does,
  LabelChip,
  LabelName,
  Button,
  Code,
  Highlight,
  Kbd,
  Hint,
  Look,
  Meter,
  Section,
  Sheet,
  Swatch,
  TextLink,
  TextPress,
  useToast,
  Wordmark,
  Emblem,
} from '@/system';
import { SYNCED, INKS, Row } from './samples.tsx';

/** Ink, type, and the words Mild uses for each thing. */
export function Foundations() {
  const toast = useToast();
  return (
    <>
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
              Text, 16px; 15px beside it. <span className="text-muted-foreground">Secondary text is lighter, not smaller.</span> A <Code>command</Code> inline,
              a <TextLink href="/system">link</TextLink>, a link to{' '}
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

      <Section title="Words" meta="lib/words.ts: one name for each thing, everywhere">
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
    </>
  );
}
