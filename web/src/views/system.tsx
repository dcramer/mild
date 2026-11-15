import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Code, Copyable, Disclosure, Highlight, Marked, Note, Sheet, SheetHead, Stamp, Wordmark } from '@/system';

const INKS = [
  ['bg-background', 'background', 'The page.'],
  ['bg-card', 'card', 'A sheet.'],
  ['bg-foreground', 'foreground', 'Ink: text, and the main action.'],
  ['bg-muted-foreground', 'muted-foreground', 'Secondary text.'],
  ['bg-(--frame)', '--frame', 'A sheet’s edge, a control’s outline.'],
  ['bg-(--rule)', '--rule', 'Lines between rows, dashed.'],
  ['bg-highlight', 'highlight', 'Look here. Nothing else is yellow.'],
  ['bg-destructive', 'destructive', 'A failure. Nothing else is red.'],
] as const;

const VARIANTS = [
  ['mark', 'What the screen is waiting on. One per screen, at most.'],
  ['ink', 'The main action of a sheet or row.'],
  ['line', 'Everything else.'],
  ['quiet', 'Repeated down a list, and ways out.'],
] as const;

/** Every part of the design system in every state, at `#system`. Add to it when the system grows. */
export function SystemView() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
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
              <span className="font-mono text-xs">{name}</span>
              <span className="text-[13px] text-muted-foreground">{use}</span>
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
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant}>Medium</Button>
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
        <SheetHead title="Note" description="Said to the reader outside the flow of the page. Dashed, so it never reads as a sheet." />
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
        {note ? <p className="text-[13px] text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}
