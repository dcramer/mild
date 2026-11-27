'use client';
import { ArchiveIcon, MailIcon, ReplyIcon } from 'lucide-react';
import { useState } from 'react';
import { type Recipient, wrongAddresses } from '@/lib/addresses.ts';
import { INBOX, outcomeName } from '@/lib/words.ts';
import {
  AnswerPicker,
  LabelPick,
  Button,
  ChoiceGroup,
  AttachButton,
  DiscardButton,
  type DraftFile,
  DraftFiles,
  MessageFiles,
  Recipients,
  DraftBlocked,
  DraftLine,
  DraftSignature,
  DraftText,
  Fact,
  Facts,
  Finish,
  MailFrame,
  Quoted,
  Menu,
  Meter,
  Popover,
  MessageHead,
  MessageStack,
  Presses,
  Reader,
  ReaderBar,
  ReplyBox,
  Trimmed,
  Section,
  SomeOf,
  TextLink,
  useToast,
} from '@/system';
import { LABELS } from './samples.tsx';

/** A message as the reader shows it, its own HTML, and the history it quotes. */
export function Reading() {
  const [reading, setReading] = useState(false);
  return (
    <>
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
    </>
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
  // A reply's lines start folded into whom it goes to.
  const [unfolded, setUnfolded] = useState(false);
  const answer = (title: string, to: (typeof THREAD)[number] = NEWEST) => {
    setReplying({ title, to });
    setUnfolded(false);
  };
  const folded = replying !== null && replying.title !== 'Forward' && !unfolded;
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
              <>
                {inbox ? (
                  <LabelPick
                    size="toolbar"
                    label="What this message is"
                    value={INBOX}
                    groups={groups}
                    onSubmit={async (id) => toast(`Answered: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`)}
                    ending={{ onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') }}
                  />
                ) : (
                  <AnswerPicker
                    key={from}
                    size="toolbar"
                    label="What this message is"
                    value={INBOX}
                    groups={groups}
                    empty={outcomeName('review')}
                    onSubmit={(id) => toast(`Answered: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`)}
                    ending={{ onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') }}
                  />
                )}
                <Popover label="Why">{said}</Popover>
              </>
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
                  to={[
                    { label: 'To', who: <SomeOf items={['me', 'grace@example.net']} /> },
                    ...(m === NEWEST ? [{ label: 'Cc' as const, who: <SomeOf items={['charles@example.org']} /> }] : []),
                  ]}
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
            {...(folded ? { to: { names: replying.to.from, onOpen: () => setUnfolded(true) } } : {})}
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
              <SpecimenDraft
                to={replying.title === 'Forward' ? [] : [{ address: replying.to.address, name: replying.to.from }]}
                quote={replying.title !== 'Forward'}
                folded={folded}
              />
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

const SIGNATURE = 'Me Example\nexample.org';

/** A draft's lines as the composer draws them: To with a chip and a wrong one, Cc and Bcc behind their presses, and files in each state. */
function SpecimenDraft({ to: start, quote, folded }: { to: Recipient[]; quote: boolean; folded: boolean }) {
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
  const [text, setText] = useState('');
  const [quoted, setQuoted] = useState(false);
  const wrong = (list: Recipient[]) => wrongAddresses(list.filter((r) => r.wrong).map((r) => r.address));
  return (
    <>
      {folded ? null : (
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
      )}
      {cc && !folded ? (
        <DraftLine label="Cc">
          <Recipients label="Cc" value={cc} onChange={setCc} {...typed('cc')} suggest={suggestPeople} />
        </DraftLine>
      ) : null}
      {bcc && !folded ? (
        <DraftLine label="Bcc">
          <Recipients label="Bcc" value={bcc} onChange={setBcc} {...typed('bcc')} suggest={suggestPeople} />
        </DraftLine>
      ) : null}
      <DraftText aria-label="Message" className="min-h-48" value={text} onChange={(event) => setText(event.target.value)} />
      {quoted ? null : quote ? (
        <Trimmed
          onShow={() => {
            setText(
              `${text.trimEnd()}\n\n-- \n${SIGNATURE}\n\nOn Nov 12, 2026, 7:32 PM, Ada Lovelace <ada@example.org> wrote:\n\n> Are you both free for lunch on Thursday?`,
            );
            setQuoted(true);
          }}
        />
      ) : (
        <DraftSignature
          text={SIGNATURE}
          onEdit={() => {
            setText(`${text.trimEnd()}\n\n-- \n${SIGNATURE}`);
            setQuoted(true);
          }}
        />
      )}
      <DraftFiles files={files} onRemove={(key) => setFiles((all) => all.filter((f) => f.key !== key))} />
    </>
  );
}
