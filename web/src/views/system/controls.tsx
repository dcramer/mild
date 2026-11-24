'use client';
import { ArrowRightIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { ACTIONS, inboxFirst } from '@/lib/words.ts';
import {
  ActionIcon,
  Button,
  Check,
  ChoiceGroup,
  ConfirmButton,
  DeleteButton,
  Ask,
  Field,
  Finish,
  FieldGroup,
  Form,
  Input,
  Kbd,
  Section,
  Select,
  Sheet,
  TextArea,
  useToast,
} from '@/system';
import { LABELS, VARIANTS, Row } from './samples.tsx';

/** Buttons, the controls a form is made of, and forms. */
export function Controls({ labelled, setLabelled }: { labelled: string; setLabelled: (labelled: string) => void }) {
  const toast = useToast();
  const [choice, setChoice] = useState<(typeof ACTIONS)[number][0]>('archive');
  const [label, setLabel] = useState<string | null>('newsletter');
  const [standing, setStanding] = useState<string | null>(null);
  const [model, setModel] = useState<'small' | 'medium' | 'large'>('small');
  const [checked, setChecked] = useState(false);
  return (
    <>
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
    </>
  );
}
