'use client';
import { useState } from 'react';
import { type MessageDetail, api } from '@/lib/api/endpoints.ts';
import { FACTS, type FactAnswer, factWords } from '@/lib/words.ts';
import { capitalised } from '@/lib/format.ts';
import { type RuleStart, factStart, listStart } from '@/lib/rule-start.ts';
import { Button, Heads, MailFrame, Quoted, RowActions, Section, Sub, Table, Td, TextPress, Th, Tr } from '@/system';
import { splitQuoted } from '@/lib/quoted.ts';
import { reveal } from '@/lib/reveal.ts';

type Shown = 'text' | 'html';
/** How this reader last chose to read a message, kept in their browser. HTML until they choose text, as a mail client shows it. */
const VIEW_KEY = 'sift:message-view';

function storedView(): Shown {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'text' ? 'text' : 'html';
  } catch {
    return 'html';
  }
}

const TEXT = 'text-reading leading-relaxed break-words whitespace-pre-wrap';

/** A message's text, with the history it quotes folded. */
export function Letter({ text }: { text: string }) {
  const { own, quoted } = splitQuoted(text);
  return (
    <div className="flex flex-col gap-2">
      <div className={TEXT}>{own}</div>
      {quoted ? (
        <Quoted>
          <div className={TEXT}>{quoted}</div>
        </Quoted>
      ) : null}
    </div>
  );
}

interface View {
  html: boolean;
  /** A design shown in its sender's colours, on white, rather than darkened. */
  original: boolean;
  onPaper: () => void;
  more: { label: string; onSelect: () => void }[];
}

/**
 * Whether a message shows as its HTML or its text, and the items of its ⋮ menu that change that (`MessageHead`'s
 * `more`), none when Mild holds no HTML for it: the choice is kept in the browser for every message after. A design's
 * HTML, once its frame says it is one, can also be shown in its original colours, for this message alone, for when
 * darkening got it wrong.
 */
export function useMessageView(detail: MessageDetail): View {
  const [view, setView] = useState(storedView);
  const [paper, setPaper] = useState(false);
  const [original, setOriginal] = useState(false);
  const html = detail.hasHtml && view === 'html';
  const choose = (next: Shown) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not remembered; this message still shows it.
    }
  };
  const colours = html && paper ? [{ label: original ? 'Show darkened' : 'Show original colours', onSelect: () => setOriginal(!original) }] : [];
  return {
    html,
    original,
    onPaper: () => setPaper(true),
    more: detail.hasHtml ? [{ label: html ? 'Show as text' : 'Show as HTML', onSelect: () => choose(html ? 'text' : 'html') }, ...colours] : [],
  };
}

/**
 * A message as Mild holds it: its HTML (`html`, from `useMessageView`), or its text when it has none or the reader chose text.
 * Its images load only once the reader presses Show images, since loading them tells the sender it was opened; the next
 * message is blocked again.
 */
export function MessageBody({ detail, view }: { detail: MessageDetail; view: Pick<View, 'html' | 'original' | 'onPaper'> }) {
  const { html, original, onPaper } = view;
  const [blocked, setBlocked] = useState(false);
  const [images, setImages] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {html && blocked && !images ? (
        <p className="text-sm text-muted-foreground">
          Remote images are blocked. <TextPress onPress={() => setImages(true)}>Show images</TextPress>
        </p>
      ) : null}
      {html ? (
        <MailFrame
          src={api.messageHtml(detail.messageId, detail.accountId, images, original)}
          title={reveal(detail.subject) || '(no subject)'}
          onBlocked={() => setBlocked(true)}
          onPaper={onPaper}
        />
      ) : detail.body === null ? (
        <p className="text-muted-foreground">
          Mild does not hold this message’s text. It keeps it only while the message waits on you, and for good once you have answered for it.
        </p>
      ) : reveal(detail.body) === '' ? (
        <p className="text-muted-foreground">This message has no readable text, or is no longer in Gmail.</p>
      ) : (
        <Letter text={reveal(detail.body)} />
      )}
    </div>
  );
}

const UNSUBSCRIBE = {
  available: 'Mild can use it',
  done: 'Mild has unsubscribed you',
  manual: 'Mild will not use it: the sender is not proven',
  none: null,
} as const;

interface Seen {
  /** What is true of the message, in the words of the rule condition it makes. */
  words: string;
  detail?: string | null;
  /** Where "Rule…" starts the rule: this sender and the fact, or the list by name. */
  rule?: RuleStart;
}

/**
 * What Mild saw in a message that a reader can use: only what is true and not the usual case (a message
 * addressed to you that passed DMARC says nothing), each in the words of the rule condition it makes, with a
 * way to make that rule.
 */
export function SeenFacts({ detail, onRule }: { detail: MessageDetail; onRule: (start: RuleStart) => void }) {
  const f = detail.facts;
  const fact = (answer: FactAnswer, extra: Omit<Seen, 'words' | 'rule'> = {}): Seen => ({
    words: capitalised(factWords(answer)),
    rule: factStart(reveal(detail.fromAddress), answer),
    ...extra,
  });
  const seen: Seen[] = [
    ...(f.isReply ? [fact({ key: 'isReply', index: 0 }, { detail: f.ownerInThread ? 'In a thread you wrote in' : null })] : []),
    ...(f.addressed === 'cc' ? [fact({ key: 'addressed', index: 1 })] : f.addressed === 'neither' ? [fact({ key: 'addressed', index: 2 })] : []),
    ...(f.dmarc === 'pass' ? [] : [fact({ key: 'dmarc', index: 1 }, { detail: 'Who sent it is not proven' })]),
    ...(f.listId ? [{ words: capitalised(factWords({ key: 'listId', index: 0 })), detail: reveal(f.listId), rule: listStart(reveal(f.listId)) }] : []),
    ...(f.unsubscribe === 'one-click'
      ? [fact({ key: 'unsubscribe', index: 0 }, { detail: UNSUBSCRIBE[detail.unsubscribe] })]
      : f.unsubscribe === 'header'
        ? [{ words: 'Has an unsubscribe link', detail: 'Mild will not follow it' }]
        : []),
    ...(f.bulkService ? [fact({ key: 'bulkService', index: 0 }, { detail: f.bulkService })] : f.markedBulk ? [fact({ key: 'markedBulk', index: 0 })] : []),
    ...(f.autoGenerated ? [{ words: 'Was sent by a program' }] : []),
    ...(f.replyToDiffers ? [fact({ key: 'replyToDiffers', index: 0 }, { detail: reveal(detail.headers['reply-to']) ?? null })] : []),
    ...(f.category ? [fact({ key: 'category', index: FACTS.category.findIndex(([value]) => value === f.category) })] : []),
    ...(f.important ? [fact({ key: 'important', index: 0 })] : []),
    ...(f.hasAttachments ? [fact({ key: 'hasAttachments', index: 0 })] : []),
    ...(f.trackingPixel
      ? [fact({ key: 'trackingPixel', index: 0 }, { detail: f.trackedLinks ? 'And its links are tracked' : null })]
      : f.trackedLinks
        ? [{ words: 'Has tracked links' }]
        : []),
  ];
  if (seen.length === 0) return null;
  return (
    <Section title="What Mild saw">
      <Table>
        <Heads>
          <Th>What Mild saw</Th>
          <Th>Rule</Th>
        </Heads>
        <tbody>
          {seen.map((s) => (
            <Tr key={s.words}>
              <Td className="w-full max-w-0">
                <span className="block">{s.words}</span>
                {s.detail ? <Sub>{s.detail}</Sub> : null}
              </Td>
              <RowActions phone="keep">
                {s.rule ? (
                  <Button variant="quiet" onClick={() => s.rule && onRule(s.rule)} aria-label={`Make a rule for mail that ${s.words.toLowerCase()}`}>
                    Rule…
                  </Button>
                ) : null}
              </RowActions>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}
