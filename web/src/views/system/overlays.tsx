'use client';
import { useState } from 'react';
import {
  Button,
  DeleteButton,
  Copyable,
  Dialog,
  Disclosure,
  Failure,
  Field,
  Form,
  Input,
  Meter,
  Note,
  Callout,
  CalloutKey,
  Panel,
  Section,
  SomeOf,
} from '@/system';

/** What opens over a page, and what is said on one: dialogs, panels, callouts, notes and failures. */
export function Overlays({ panel, setPanel }: { panel: boolean; setPanel: (open: boolean) => void }) {
  const [dialog, setDialog] = useState(false);
  return (
    <>
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
        <p className="max-w-[68ch] text-reading leading-relaxed">One item of a list: a rule, a label, Settings. A message opens in the list’s place instead.</p>
      </Panel>
    </>
  );
}
