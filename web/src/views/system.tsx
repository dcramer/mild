import { ArrowRightIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  Button,
  Check,
  Code,
  Copyable,
  Disclosure,
  Card,
  CardFoot,
  CardGrid,
  CardHead,
  Dialog,
  FilterGroup,
  ListView,
  Empty,
  Figure,
  Figures,
  Highlight,
  Input,
  Loading,
  Marked,
  Masthead,
  Note,
  Notice,
  Sections,
  Select,
  Sheet,
  SheetHead,
  StackedBars,
  Stamp,
  SubNav,
  Table,
  Td,
  TextArea,
  Th,
  Tr,
  Wordmark,
} from '@/system';

const SERIES = [
  { key: 'a', name: 'Rules', color: 'var(--tier-rules)' },
  { key: 'b', name: 'Sender memory', color: 'var(--tier-sender)' },
  { key: 'c', name: 'Agent', color: 'var(--tier-agent)' },
  { key: 'd', name: 'Undecided', color: 'var(--tier-fallback)' },
];
const DAYS = [
  [12, 5, 3, 1],
  [8, 9, 2, 0],
  [15, 4, 6, 2],
  [0, 0, 0, 0],
  [9, 11, 1, 0],
  [20, 6, 4, 3],
  [14, 7, 2, 1],
].map(([a = 0, b = 0, c = 0, d = 0], index) => ({ key: String(index), label: `Nov ${index + 9}`, title: `Nov ${index + 9}`, values: { a, b, c, d } }));
const CHOICES = [
  ['keep', 'Keep in inbox'],
  ['archive', 'Archive'],
  ['spam', 'Mark spam'],
] as const;

const INKS = [
  ['bg-background', 'background', 'The page.'],
  ['bg-card', 'card', 'A sheet.'],
  ['bg-foreground', 'foreground', 'Ink: text, and the main action.'],
  ['bg-muted-foreground', 'muted-foreground', 'Secondary text.'],
  ['bg-(--frame)', '--frame', 'A sheet’s edge.'],
  ['bg-(--rule)', '--rule', 'Lines between rows, dashed.'],
  ['bg-(--fill)', '--fill', 'What a control is filled with.'],
  ['bg-highlight', 'highlight', 'Look here. Nothing else is yellow.'],
  ['bg-destructive', 'destructive', 'A failure. Nothing else is red.'],
] as const;

const VARIANTS = [
  ['mark', 'What the screen is waiting on. One per screen, at most.'],
  ['ink', 'The main action of a sheet or row.'],
  ['plain', 'Everything else.'],
  ['quiet', 'Repeated down a list, and ways out.'],
] as const;

/** Every part of the design system in every state, at `#system`. Add to it when the system grows. */
export function SystemView() {
  const [choice, setChoice] = useState<(typeof CHOICES)[number][0]>('archive');
  const [checked, setChecked] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState('');
  const [made, setMade] = useState('');
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <header className="flex items-baseline gap-4">
        <Wordmark />
        <p className="slug text-muted-foreground">Design system</p>
      </header>

      <Sheet>
        <SheetHead title="Ink" description="Dark only. Two colours carry meaning; everything else is ink at some strength." />
        <div className="grid grid-cols-2 gap-px bg-(--rule) sm:grid-cols-4">
          {INKS.map(([swatch, name, use]) => (
            <div key={name} className="flex flex-col gap-2 bg-card p-4">
              <span aria-hidden className={`h-10 border border-(--frame) ${swatch}`} />
              <span className="font-mono text-[14px]">{name}</span>
              <span className="text-sm text-muted-foreground">{use}</span>
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet>
        <SheetHead title="Type" description="By role, not by size. Display face for what is named or counted, mono capitals for labels." />
        <Row label="statement">
          <p className="statement">The one line a screen opens with.</p>
        </Row>
        <Row label="figure">
          <p className="figure">
            1,284 <Highlight className="mx-0">37</Highlight>
          </p>
        </Row>
        <Row label="title">
          <p className="title">A sheet’s heading</p>
        </Row>
        <Row label="name">
          <p className="name">A sender, a rule, an account</p>
        </Row>
        <Row label="body">
          <p>
            Text, 14px. <span className="text-muted-foreground">Secondary text is the same size, lighter.</span> A <Code>command</Code> inline.
          </p>
        </Row>
        <Row label="slug">
          <p className="slug text-muted-foreground">Column head · label · dateline</p>
        </Row>
      </Sheet>

      <Sheet>
        <SheetHead title="Button" description="Corners cut by hand. Given an address it is a link that looks the same." />
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
      </Sheet>

      <Sheet>
        <SheetHead title="Controls" description="Filled, never outlined. A select is for a short list; anything longer needs a different part." />
        <Row label="select">
          <Select label="What sift does" value={choice} options={CHOICES} onChange={setChoice} />
          <Select label="Disabled" value={choice} options={CHOICES} onChange={setChoice} disabled />
        </Row>
        <Row label="input">
          <Input aria-label="Example" placeholder="example.com" className="w-56" />
          <Input aria-label="Disabled" placeholder="Disabled" className="w-40" disabled />
        </Row>
        <Row label="check">
          <Check checked={checked} onChange={setChecked}>
            Include mail sift would keep
          </Check>
        </Row>
        <Row label="text area">
          <div className="w-full max-w-xl">
            <TextArea aria-label="Example" className="min-h-20" defaultValue="Anything from my accountant stays in the inbox." />
          </div>
        </Row>
      </Sheet>

      <div className="border border-dashed border-(--rule) p-4">
        <ListView
          title="List view"
          count="3 things"
          description="How every screen shows many of one thing. The filter button opens a panel that pushes the list left; filters that are on stay listed when it is closed."
          actions={<Button variant="ink">Add one</Button>}
          search={{ value: search, onChange: setSearch, placeholder: 'Search' }}
          filters={{
            active: made === '' ? [] : [{ label: `Made by: ${made}`, clear: () => setMade('') }],
            panel: (
              <FilterGroup
                label="Made by"
                value={made}
                options={[
                  ['', 'Anyone'],
                  ['you', 'You'],
                  ['sift', 'sift'],
                ]}
                onChange={setMade}
              />
            ),
          }}
        >
          <CardGrid>
            {['Example Weekly', 'Shop', 'Ada Lovelace']
              .filter((name) => name.toLowerCase().includes(search.toLowerCase()))
              .map((name) => (
                <Card key={name}>
                  <CardHead title={name} note="A card stands for one thing" aside="12" onOpen={() => setDrawer(true)} />
                  <p className="text-sm text-muted-foreground">Head, body, foot. Pressing the card opens it; the foot holds what needs no opening.</p>
                  <CardFoot>
                    <Button variant="ink">Right</Button>
                    <Button>Something else</Button>
                  </CardFoot>
                </Card>
              ))}
          </CardGrid>
        </ListView>
      </div>

      <Sheet>
        <SheetHead
          title="Navigation"
          description="Sections are highlighted when current. Pages within a section are quieter: a stroke beside the current one."
        />
        <div className="row px-4">
          <Masthead
            current="system"
            items={[
              { to: 'system', label: 'Suggestions', count: 12 },
              { to: 'system/overview', label: 'Overview' },
              { to: 'system/rules', label: 'Rules' },
            ]}
            status={<Notice>Offline</Notice>}
            aside={<span>On a narrow screen this becomes a menu button and a panel that covers the screen.</span>}
          />
        </div>
        <Row label="notice" note="A state of sift itself, in the masthead. Plain mends itself; highlighted needs the reader.">
          <Notice>Offline</Notice>
          <Notice tone="look" href="/system" action="Reconnect">
            Google sign-in expired
          </Notice>
        </Row>
        <Row label="sections">
          <Sections
            current="system"
            items={[
              { to: 'system', label: 'Suggestions', count: 12 },
              { to: 'system/overview', label: 'Overview' },
              { to: 'system/rules', label: 'Rules' },
            ]}
          />
        </Row>
        <div className="row px-4 py-4">
          <SubNav
            label="Example pages"
            current="system"
            items={[
              { to: 'system', label: 'Running' },
              { to: 'system/accounts', label: 'Accounts' },
              { to: 'system/kinds', label: 'Kinds of mail' },
            ]}
          >
            <p className="text-muted-foreground">The current page goes here. One page shows at a time.</p>
          </SubNav>
        </div>
      </Sheet>

      <Figures>
        <Figure label="No model needed" value="84%" note="1,079 of 1,284" tone="look" />
        <Figure label="Decisions" value="1,284" note="1,301 received" />
        <Figure label="Model cost" value="$0.42" />
        <Figure label="Changes to check" value="2" tone="failure" />
      </Figures>

      <div className="grid gap-6 lg:grid-cols-2">
        <Sheet>
          <SheetHead title="Chart" description="Point at a column, or tab to it, and the legend reads it out." />
          <StackedBars unit="decisions" series={SERIES} rows={DAYS} />
        </Sheet>
        <Sheet>
          <SheetHead title="Table" description="A row with somewhere to go is pressable as a whole." />
          <Table>
            <thead>
              <Tr>
                <Th>Sender</Th>
                <Th num>Messages</Th>
                <Th>Outcome</Th>
              </Tr>
            </thead>
            <tbody>
              <Tr onOpen={() => setDrawer(true)}>
                <Td>news@example.com</Td>
                <Td num>16</Td>
                <Td>
                  <Stamp tone="tint">Archived</Stamp>
                </Td>
              </Tr>
              <Tr onOpen={() => setDrawer(true)}>
                <Td>founder@example.org</Td>
                <Td num>3</Td>
                <Td>
                  <Stamp tone="look">Left for review</Stamp>
                </Td>
              </Tr>
            </tbody>
          </Table>
        </Sheet>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Sheet>
          <SheetHead title="Empty" description="One plain sentence." />
          <Empty>None yet. Answering a suggestion adds one.</Empty>
        </Sheet>
        <Sheet>
          <SheetHead title="Loading" description="Stands in for rows on their way." />
          <Loading rows={3} />
        </Sheet>
      </div>
      <Dialog
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Dialog: one thing, opened from the page"
        footer={
          <Button variant="ink" onClick={() => setDrawer(false)}>
            Done
          </Button>
        }
      >
        <p className="text-muted-foreground">
          Read or answered without leaving the page. Escape or a press outside closes it; on a phone it covers the screen.
        </p>
      </Dialog>

      <Sheet>
        <SheetHead
          title="Stamp and highlight"
          description="A stamp is a verdict; its weight is its meaning. Highlighter marks what the reader should look at."
        />
        <Row label="stamp">
          <Stamp>Keep</Stamp>
          <Stamp tone="tint">Archive</Stamp>
          <Stamp tone="ink">Spam</Stamp>
          <Stamp tone="look">Review</Stamp>
        </Row>
        <Row label="highlight">
          <p>
            Three senders are <Highlight>waiting on you</Highlight>.
          </p>
        </Row>
        <Row label="marked">
          <p>
            <Marked text="Your invoice for November is ready" term="invoice" />
          </p>
        </Row>
      </Sheet>

      <Sheet>
        <SheetHead title="Note" description="Said to the reader outside the flow of the page. No box; the label sets it apart." />
        <div className="grid gap-4 p-4 sm:grid-cols-3">
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
      </Sheet>

      <Sheet>
        <SheetHead title="Copyable and disclosure" description="A value carried somewhere else whole; and what most readers never need." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Copyable value="sudo tailscale serve --bg 8787" label="command" />
          <Disclosure summary="Google says redirect_uri_mismatch">
            <p>Shown only to the reader who went looking.</p>
          </Disclosure>
        </div>
      </Sheet>
    </main>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="row grid items-center gap-x-4 gap-y-2 px-4 py-4 sm:grid-cols-[7rem_1fr]">
      <div>
        <p className="slug text-muted-foreground">{label}</p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">{children}</div>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}
