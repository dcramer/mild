import { ArrowRightIcon, CheckIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { willBe } from '@/lib/format.ts';
import { cn } from '@/lib/utils';
import { Button, Highlight, Input, Note, Select, Sheet, Stamp, Wordmark } from '@/system';

/**
 * Three ways the review screen could work, on made-up mail. Temporary: once one is chosen it replaces
 * the Suggestions view and this file goes. Nothing here reads or writes real data.
 */

const LABELS = [
  { id: 'personal', name: 'Personal', does: 'keep' },
  { id: 'security', name: 'Security', does: 'keep' },
  { id: 'receipts', name: 'Receipts', does: 'keep' },
  { id: 'notifications', name: 'Notifications', does: 'keep' },
  { id: 'newsletters', name: 'Newsletters', does: 'archive' },
  { id: 'marketing', name: 'Marketing', does: 'archive' },
  { id: 'cold', name: 'Cold outreach', does: 'review' },
  { id: 'junk', name: 'Junk', does: 'review' },
] as const;
type LabelId = (typeof LABELS)[number]['id'];
const label = (id: LabelId) => LABELS.find((l) => l.id === id) ?? LABELS[0];
const TONE = { keep: 'outline', archive: 'tint', spam: 'ink', review: 'look' } as const;
const DOES = { keep: 'Keep in inbox', archive: 'Archive', spam: 'Mark spam', review: 'Leave for me' } as const;
type Action = keyof typeof DOES;

interface Item {
  id: string;
  name: string;
  address: string;
  messages: number;
  subjects: { text: string; times: number }[];
  /** sift's guess, or null if it could not place the mail. */
  guess: LabelId | null;
  why: string;
  by: string;
}

const QUEUE: Item[] = [
  {
    id: 'n',
    name: 'Northwind Capital',
    address: 'updates@northwind.example',
    messages: 1,
    subjects: [{ text: 'Q3 update for investors', times: 1 }],
    guess: null,
    why: 'Reads like a newsletter, but you have written to this sender 14 times.',
    by: 'Model',
  },
  {
    id: 'a',
    name: 'Ada Lovelace',
    address: 'ada@example.org',
    messages: 3,
    subjects: [{ text: 'Re: notes from Thursday', times: 3 }],
    guess: null,
    why: 'No rule covers it and no model is set.',
    by: 'Undecided',
  },
  {
    id: 'w',
    name: 'Example Weekly',
    address: 'news@example.com',
    messages: 39,
    subjects: [
      { text: 'Your weekly digest', times: 36 },
      { text: 'A special issue: the year in review', times: 3 },
    ],
    guess: 'newsletters',
    why: 'Sent to a list you subscribed to; has an unsubscribe header.',
    by: 'Model',
  },
  {
    id: 's',
    name: 'Shop',
    address: 'deals@shop.example',
    messages: 37,
    subjects: [
      { text: '48 hours only: 30% off everything', times: 30 },
      { text: 'Your order has shipped', times: 7 },
    ],
    guess: 'marketing',
    why: 'Promotional; you have never replied.',
    by: 'Model',
  },
  {
    id: 'c',
    name: 'CI',
    address: 'notifications@example.dev',
    messages: 28,
    subjects: [
      { text: 'Build passed on main', times: 25 },
      { text: 'Build failed on main', times: 3 },
    ],
    guess: 'notifications',
    why: 'Automated activity from a service you use.',
    by: 'Model',
  },
  {
    id: 'r',
    name: 'Sam Rivera',
    address: 'sam@growth.example',
    messages: 24,
    subjects: [
      { text: 'Quick question about your roadmap', times: 20 },
      { text: 'Following up', times: 4 },
    ],
    guess: 'cold',
    why: 'An unsolicited pitch from someone you have never written to.',
    by: 'Model',
  },
  {
    id: 'b',
    name: 'Cellar Auctions',
    address: 'bids@auctions.example',
    messages: 6,
    subjects: [
      { text: 'You have been outbid on lot 214', times: 4 },
      { text: 'This week’s featured lots', times: 2 },
    ],
    guess: 'marketing',
    why: 'Bulk mail from a shop.',
    by: 'Model',
  },
  {
    id: 'p',
    name: 'Example Billing',
    address: 'billing@example.net',
    messages: 2,
    subjects: [{ text: 'Receipt for your payment', times: 2 }],
    guess: 'receipts',
    why: 'A receipt for something you paid for.',
    by: 'Model',
  },
];

type Scope = 'sender' | 'domain' | 'subject' | 'once';
interface Answer {
  label: LabelId;
  /** An exception to the label's action, or null to do what the label does. */
  action: Action | null;
  scope: Scope;
  contains: string;
}

const domain = (item: Item) => item.address.split('@')[1] ?? '';
const scopeText = (item: Item, answer: Pick<Answer, 'scope' | 'contains'>) =>
  answer.scope === 'domain'
    ? `mail from anyone at ${domain(item)}`
    : answer.scope === 'subject'
      ? `mail from ${item.address} with “${answer.contains || '…'}” in the subject`
      : answer.scope === 'once'
        ? `these ${item.messages === 1 ? 'message' : `${item.messages} messages`}`
        : `mail from ${item.address}`;

/** What an answer will teach sift, as the sentence it will be told. */
function outcome(item: Item, answer: Answer): string {
  const does = answer.action ?? label(answer.label).does;
  const what = `${label(answer.label).name}: ${willBe(does)}`;
  return answer.scope === 'once' ? `Only ${scopeText(item, answer)}: ${what}. No rule is made.` : `From now on, ${scopeText(item, answer)} is ${what}.`;
}

function useQueue() {
  const [items, setItems] = useState(QUEUE);
  const [learned, setLearned] = useState<string[]>([]);
  return {
    items,
    learned,
    answer: (item: Item, answer: Answer) => {
      setItems((all) => all.filter((i) => i.id !== item.id));
      setLearned((lines) => [outcome(item, answer), ...lines].slice(0, 3));
    },
    reset: () => {
      setItems(QUEUE);
      setLearned([]);
    },
  };
}
type Queue = ReturnType<typeof useQueue>;

const scopes = (item: Item) =>
  [
    ['sender', 'Everything from this sender'],
    ['domain', `Anyone at ${domain(item)}`],
    ['subject', 'This sender, when the subject contains…'],
    ['once', 'Only these messages'],
  ] as const;

function Subjects({ item, max = 3 }: { item: Item; max?: number }) {
  return (
    <ul className="flex flex-col text-[13px] text-muted-foreground">
      {item.subjects.slice(0, max).map((s) => (
        <li key={s.text} className="flex items-baseline gap-2 py-0.5">
          <span className="truncate">{s.text}</span>
          {s.times > 1 ? <span className="shrink-0 tabular-nums">×{s.times}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Guess({ item }: { item: Item }) {
  if (item.guess === null) return <Stamp tone="look">Not sure</Stamp>;
  const l = label(item.guess);
  return (
    <>
      <span className="name">{l.name}</span>
      <Stamp tone={TONE[l.does]}>{DOES[l.does]}</Stamp>
    </>
  );
}

function Learned({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <Note title="Learned">
      <ul aria-live="polite" className="flex flex-col gap-0.5">
        {lines.map((line, index) => (
          <li key={index} className={index === 0 ? undefined : 'text-muted-foreground'}>
            {line}
          </li>
        ))}
      </ul>
    </Note>
  );
}

function Done({ queue }: { queue: Queue }) {
  return (
    <Sheet className="items-start gap-3 px-6 py-8">
      <p className="statement">Nothing is waiting on you.</p>
      <Button onClick={queue.reset}>Start the example again</Button>
    </Sheet>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* A. One at a time: a focused card per sender, answered from the keyboard.                         */

function OneAtATime({ queue }: { queue: Queue }) {
  const [at, setAt] = useState(0);
  const { items } = queue;
  const index = Math.min(at, items.length - 1);
  const item = items[index];
  if (!item) return <Done queue={queue} />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-4 md:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Waiting" className="hidden md:block">
        <ul className="flex flex-col gap-y-0.5">
          {items.map((i, n) => (
            <li key={i.id}>
              <button
                type="button"
                aria-current={n === index ? 'true' : undefined}
                className="flex w-full cursor-pointer items-baseline gap-2 border-l-2 border-transparent px-2.5 py-1.5 text-left text-[13px] text-muted-foreground hover:text-foreground aria-[current=true]:border-highlight aria-[current=true]:font-semibold aria-[current=true]:text-foreground"
                onClick={() => setAt(n)}
              >
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <span className="tabular-nums">{i.messages}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-4">
        <Card
          key={item.id}
          item={item}
          position={`${index + 1} of ${items.length}`}
          onAnswer={(a) => queue.answer(item, a)}
          onMove={(by) => setAt(Math.max(0, Math.min(items.length - 1, index + by)))}
        />
        <Learned lines={queue.learned} />
      </div>
    </div>
  );
}

function Card({ item, position, onAnswer, onMove }: { item: Item; position: string; onAnswer: (answer: Answer) => void; onMove: (by: number) => void }) {
  const [chosen, setChosen] = useState<LabelId | null>(item.guess);
  const [scope, setScope] = useState<Scope>('sender');
  const [contains, setContains] = useState('');
  const [action, setAction] = useState<Action | ''>('');
  const answer: Answer | null = chosen ? { label: chosen, action: action === '' ? null : action, scope, contains } : null;
  const ready = answer !== null && (scope !== 'subject' || contains.trim() !== '');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const picked = LABELS[Number(event.key) - 1];
      if (picked) setChosen(picked.id);
      else if (event.key === 'Enter' && ready && answer && !(event.target instanceof HTMLButtonElement)) onAnswer(answer);
      else if (event.key === 'j' || event.key === 's') onMove(1);
      else if (event.key === 'k') onMove(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Sheet className="gap-6 px-6 py-6">
      <div className="flex flex-col gap-2">
        <p className="slug text-muted-foreground">
          {position} · {item.messages} {item.messages === 1 ? 'message' : 'messages'}
        </p>
        <p className="statement">{item.name}</p>
        <p className="text-muted-foreground">{item.address}</p>
        <Subjects item={item} max={4} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="slug text-muted-foreground">sift says</p>
        <p className="flex flex-wrap items-center gap-2">
          <Guess item={item} />
        </p>
        <p className="text-[13px] text-muted-foreground">{item.why}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="slug text-muted-foreground">It is</p>
        <div className="flex flex-wrap gap-1.5">
          {LABELS.map((l, n) => (
            <Button key={l.id} size="sm" variant={chosen === l.id ? 'ink' : 'plain'} aria-pressed={chosen === l.id} onClick={() => setChosen(l.id)}>
              <span className="font-mono text-[11px] font-normal opacity-60">{n + 1}</span>
              {l.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="slug text-muted-foreground">For</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {scopes(item).map(([key, text]) => (
            <Button key={key} size="sm" variant={scope === key ? 'ink' : 'plain'} aria-pressed={scope === key} onClick={() => setScope(key)}>
              {text}
            </Button>
          ))}
          {scope === 'subject' ? (
            <Input
              autoFocus
              aria-label="Words in the subject"
              placeholder="outbid"
              className="w-44"
              value={contains}
              onChange={(event) => setContains(event.target.value)}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-dashed border-(--rule) pt-5">
        {answer ? (
          <p>
            {outcome(item, answer)}{' '}
            <span className="inline-flex align-middle">
              <Select
                label="Exception to the label's action"
                value={action}
                options={[
                  ['', 'as the label says'] as const,
                  ['keep', 'but keep it'] as const,
                  ['archive', 'but archive it'] as const,
                  ['spam', 'but mark it spam'] as const,
                ]}
                onChange={setAction}
              />
            </span>
          </p>
        ) : (
          <p className="text-muted-foreground">Choose what this is.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="mark" disabled={!ready} onClick={() => answer && onAnswer(answer)}>
            {chosen !== null && chosen === item.guess ? 'Right' : 'Teach sift'}
            <ArrowRightIcon aria-hidden />
          </Button>
          <Button variant="quiet" onClick={() => onMove(1)}>
            Skip
          </Button>
          <p className="slug ml-auto hidden text-muted-foreground md:block">Enter confirm · 1–8 label · J K move</p>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* B. By label: sift's guesses sorted into piles, each confirmed in one press.                      */

function ByLabel({ queue }: { queue: Queue }) {
  const { items } = queue;
  if (items.length === 0) return <Done queue={queue} />;
  const unsure = items.filter((i) => i.guess === null);
  const piles = LABELS.map((l) => ({ label: l, items: items.filter((i) => i.guess === l.id) }))
    .filter((p) => p.items.length > 0)
    .toSorted((a, b) => total(b.items) - total(a.items));
  const teach = (item: Item, to: LabelId) => queue.answer(item, { label: to, action: null, scope: 'sender', contains: '' });

  return (
    <div className="flex flex-col gap-4">
      <Learned lines={queue.learned} />
      {unsure.length > 0 ? (
        <Sheet>
          <PileHead title={<Stamp tone="look">Not sure</Stamp>} note={`${count(unsure)} · sift needs you to say what these are`} />
          <ul>
            {unsure.map((item) => (
              <PileRow key={item.id} item={item} prompt="It is…" onTeach={(to) => teach(item, to)} />
            ))}
          </ul>
        </Sheet>
      ) : null}
      {piles.map((pile) => (
        <Sheet key={pile.label.id}>
          <PileHead
            title={
              <>
                <span className="title">{pile.label.name}</span>
                <Stamp tone={TONE[pile.label.does]}>{DOES[pile.label.does]}</Stamp>
              </>
            }
            note={count(pile.items)}
            action={
              <Button variant="ink" size="sm" onClick={() => pile.items.forEach((item) => teach(item, pile.label.id))}>
                <CheckIcon aria-hidden />
                {pile.items.length === 1 ? 'Right' : `All ${pile.items.length} right`}
              </Button>
            }
          />
          <ul>
            {pile.items.map((item) => (
              <PileRow key={item.id} item={item} prompt="Not this…" except={pile.label.id} onTeach={(to) => teach(item, to)} />
            ))}
          </ul>
        </Sheet>
      ))}
    </div>
  );
}

const total = (items: Item[]) => items.reduce((sum, i) => sum + i.messages, 0);
const count = (items: Item[]) => `${items.length} ${items.length === 1 ? 'sender' : 'senders'} · ${total(items)} messages`;

function PileHead({ title, note, action }: { title: ReactNode; note: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 pb-2">
      {title}
      <span className="text-[13px] text-muted-foreground tabular-nums">{note}</span>
      <span className="ml-auto">{action}</span>
    </div>
  );
}

function PileRow({ item, prompt, except, onTeach }: { item: Item; prompt: string; except?: LabelId; onTeach: (to: LabelId) => void }) {
  return (
    <li className="row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[14rem_minmax(0,1fr)_4rem_auto]">
      <span className="min-w-0">
        <span className="block truncate font-medium">{item.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{item.address}</span>
      </span>
      <span className="hidden truncate text-[13px] text-muted-foreground md:block">{item.subjects.map((s) => s.text).join(' · ')}</span>
      <span className="hidden text-right text-[13px] text-muted-foreground tabular-nums md:block">{item.messages}</span>
      <Select
        label={`What mail from ${item.name} is`}
        value=""
        options={[['', prompt] as const, ...LABELS.filter((l) => l.id !== except).map((l) => [l.id, `${l.name} (${willBe(l.does)})`] as const)]}
        onChange={(to) => to !== '' && onTeach(to)}
      />
    </li>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* C. A sentence per sender: every part of the rule is on the row and can be changed in place.      */

function Sentences({ queue }: { queue: Queue }) {
  if (queue.items.length === 0) return <Done queue={queue} />;
  return (
    <div className="flex flex-col gap-4">
      <Learned lines={queue.learned} />
      <Sheet>
        <ul>
          {queue.items.map((item) => (
            <Sentence key={item.id} item={item} onAnswer={(answer) => queue.answer(item, answer)} />
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

function Sentence({ item, onAnswer }: { item: Item; onAnswer: (answer: Answer) => void }) {
  const [chosen, setChosen] = useState<LabelId | ''>(item.guess ?? '');
  const [scope, setScope] = useState<Scope>('sender');
  const [contains, setContains] = useState('');
  const [action, setAction] = useState<Action | ''>('');
  const [open, setOpen] = useState(false);
  const ready = chosen !== '' && (scope !== 'subject' || contains.trim() !== '');
  const changed = chosen !== (item.guess ?? '') || scope !== 'sender' || action !== '';

  return (
    <li className={cn('row flex flex-col gap-2 px-4 py-3', item.guess === null && 'bg-highlight/5')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-baseline gap-2 text-left md:w-72"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="name truncate">{item.name}</span>
          <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{item.messages}</span>
        </button>
        <span className="text-[13px] text-muted-foreground">is</span>
        {item.guess === null && chosen === '' ? <Highlight className="mx-0 text-[13px]">you say</Highlight> : null}
        <Select label="Label" value={chosen} options={[['', 'Choose…'] as const, ...LABELS.map((l) => [l.id, l.name] as const)]} onChange={setChosen} />
        <span className="text-[13px] text-muted-foreground">so</span>
        <Select
          label="What happens"
          value={action}
          options={[
            ['', chosen === '' ? 'do what the label says' : DOES[label(chosen).does].toLowerCase()] as const,
            ...(['keep', 'archive', 'spam'] as const).map((a) => [a, `${DOES[a].toLowerCase()} instead`] as const),
          ]}
          onChange={setAction}
        />
        <span className="text-[13px] text-muted-foreground">for</span>
        <Select label="Scope" value={scope} options={scopes(item)} onChange={setScope} />
        {scope === 'subject' ? (
          <Input
            aria-label="Words in the subject"
            placeholder="outbid"
            className="w-36"
            value={contains}
            onChange={(event) => setContains(event.target.value)}
          />
        ) : null}
        <span className="ml-auto">
          <Button
            variant="ink"
            size="sm"
            disabled={!ready}
            onClick={() => chosen !== '' && onAnswer({ label: chosen, action: action === '' ? null : action, scope, contains })}
          >
            <CheckIcon aria-hidden />
            {changed || item.guess === null ? 'Teach' : 'Right'}
          </Button>
        </span>
      </div>
      {open ? (
        <div className="flex flex-col gap-1 md:pl-0">
          <p className="text-[13px] text-muted-foreground">
            {item.address} · {item.why}
          </p>
          <Subjects item={item} max={5} />
        </div>
      ) : (
        <p className="truncate text-[13px] text-muted-foreground">{item.subjects[0]?.text}</p>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------------------------------------- */

const CONCEPTS = [
  {
    key: 'a',
    name: 'A. One at a time',
    pitch:
      'A focused card per sender. Labels are one press, the scope of the rule is chosen in place, and the sentence at the bottom is exactly what sift will be taught. Built for the keyboard.',
  },
  {
    key: 'b',
    name: 'B. By label',
    pitch:
      'sift’s guesses are sorted into piles. Agree with a whole pile in one press and pull out only what is wrong. Fastest when sift is mostly right; no room for scope or exceptions.',
  },
  {
    key: 'c',
    name: 'C. A sentence each',
    pitch:
      'One dense list. Each row reads as the rule it will make, with the label, the action and the scope changeable in place. Everything visible at once; busier.',
  },
] as const;

export function ConceptsView({ which }: { which: string | undefined }) {
  const current = CONCEPTS.find((c) => c.key === which) ?? CONCEPTS[0];
  const queue = useQueue();
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-7xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Wordmark />
        <p className="slug text-muted-foreground">Review screen · three concepts · example mail</p>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {CONCEPTS.map((c) => (
            <Button key={c.key} size="sm" variant={c.key === current.key ? 'ink' : 'plain'} href={`#concepts/${c.key}`} onClick={queue.reset}>
              {c.name}
            </Button>
          ))}
        </div>
      </header>
      <p className="max-w-3xl text-muted-foreground">{current.pitch}</p>
      <p className="title tabular-nums">
        {queue.items.length > 0 ? <Highlight className="mx-0">{total(queue.items)}</Highlight> : 'Nothing'} waiting
        {queue.items.length > 0 ? <span className="font-normal text-muted-foreground"> from {queue.items.length} senders</span> : null}
      </p>
      {current.key === 'a' ? <OneAtATime queue={queue} /> : current.key === 'b' ? <ByLabel queue={queue} /> : <Sentences queue={queue} />}
    </main>
  );
}
