'use client';
import { type ReactNode, useState } from 'react';
import { type Party, type Recipient, wrongAddresses } from '@/lib/addresses.ts';
import { api } from '@/lib/api/endpoints.ts';
import { useSession } from '@/lib/api/reads.ts';
import type { From } from '@/lib/answering.ts';
import { useAutosave } from '@/lib/autosave.ts';
import type { Draft, Writing } from '@/lib/compose.ts';
import { blank } from '@/lib/draft-checks.ts';
import { dateTime } from '@/lib/format.ts';
import { reveal } from '@/lib/reveal.ts';
import { Ask, AttachButton, Button, DiscardButton, DraftFiles, DraftLine, DraftText, Finish, Input, Panel, Recipients, ReplyBox, Select } from '@/system';
import type { MessageDetail } from '../../../../src/dashboard/types.ts';
import { AnswerKind } from './answer-kind.tsx';
import { useDraftFiles } from './files.ts';
import { useFocus } from './focus.ts';
import { usePresses } from './presses.ts';
import { ScheduleSend } from './schedule-send.tsx';
import { SendBlocked } from './send-blocked.tsx';

/** Mild's copy of a draft, and when it is scheduled to go or why it did not. */
export type SavedDraft = { draft: Draft; sendAt: number | null; sendError: string | null } | null;

/** Whom to suggest as an address is typed: the person's own address book, on the server. */
const suggest = async (q: string, signal: AbortSignal): Promise<Party[]> =>
  (await api.addresses(q, signal)).addresses.map((a) => ({ address: reveal(a.address), ...(a.name ? { name: reveal(a.name) } : {}) }));

/** What is wrong with a line's recipients, in a sentence, or null. */
const wrongOf = (list: readonly Recipient[]) => wrongAddresses(list.filter((r) => r.wrong).map((r) => r.address));

/** The composer's fields, text and presses: in a panel of their own for new mail, in place under the conversation (`inline`) for a reply or a forward. */
export function Writer({
  what,
  title,
  subject,
  choices,
  start,
  startFor,
  saved,
  answered,
  inline = false,
  about,
  onClose,
}: {
  what: Writing;
  /** Mild's copy of this draft, kept if it is newer than this browser's, and its schedule. */
  saved: SavedDraft;
  title: string;
  /** A reply's, which the server sets. */
  subject?: string;
  choices: readonly From[];
  start: Draft;
  /** How a reply or forward of the same message starts, for the menu that changes one into another. */
  startFor?: (what: Exclude<Writing, { kind: 'new' }>) => Draft;
  /** The message a reply or forward answers, whose files a forward carries, and a reply that asks. */
  answered?: MessageDetail;
  inline?: boolean;
  about?: ReactNode;
  onClose: () => void;
}) {
  const who = useSession('').data?.email ?? '';
  const empty = (d: Draft) => blank(d, start, subject);
  const autosave = useAutosave(who, what, saved, start, choices, empty);
  const { draft, change, scheduled } = autosave;
  // What is typed in each line that is not a chip yet.
  const [typing, setTyping] = useState({ to: '', cc: '', bcc: '' });
  const { uploading, attach, carried, shown, detach } = useDraftFiles(what, draft, change, answered);
  const { toInput, entered, textField, first, askFor } = useFocus(what, draft, inline);

  const from = choices.find((c) => c.address === draft.from) ?? choices[0];
  const { send, schedule, discard, switchTo, asking, dismiss, nobody, wrong, waiting } = usePresses({
    who,
    what,
    title,
    subject,
    startFor,
    autosave,
    empty,
    typing,
    setTyping,
    from,
    carried,
    uploading,
    onClose,
  });

  const fromLine =
    choices.length > 1 ? (
      <DraftLine label="From">
        <Select
          label="From"
          value={from.address}
          options={choices.map((c) => [c.address, c.address] as const)}
          onChange={(address) => change({ from: address })}
        />
      </DraftLine>
    ) : null;

  // Nothing to write in until Google lets Mild send from this mailbox: only the press that asks, and any other address to send from.
  if (!from.canSend) return <SendBlocked accountId={from.accountId} title={title} fromLine={fromLine} inline={inline} about={about} onClose={onClose} />;

  const actions = (
    <>
      {asking ? (
        <Ask key={asking.question} question={asking.question} onYes={() => send([...asking.answered, asking.question])} onNo={dismiss}>
          Send
        </Ask>
      ) : (
        <>
          <Finish
            disabled={nobody || wrong || waiting}
            {...(nobody ? { why: 'Say who it is to.' } : wrong ? { why: 'An address is wrong.' } : waiting ? { why: 'A file is still uploading.' } : {})}
            onClick={() => send()}
          >
            Send
          </Finish>
          {nobody || wrong || waiting ? null : <ScheduleSend onSchedule={schedule} />}
          <AttachButton onFiles={attach} />
        </>
      )}
      <DiscardButton onClick={discard} />
    </>
  );

  const lineFor = (line: 'cc' | 'bcc') => (
    <DraftLine label={line === 'cc' ? 'Cc' : 'Bcc'} error={wrongOf(draft[line])}>
      <Recipients
        label={line === 'cc' ? 'Cc' : 'Bcc'}
        value={draft[line]}
        onChange={(next) => change({ [line]: next })}
        text={typing[line]}
        onText={(text) => setTyping((was) => ({ ...was, [line]: text }))}
        suggest={suggest}
        inputRef={entered[line]}
      />
    </DraftLine>
  );
  const ask = (line: 'cc' | 'bcc') => (
    <Button
      variant="quiet"
      onClick={() => {
        askFor(line);
        change(line === 'cc' ? { showCc: true } : { showBcc: true });
      }}
    >
      {line === 'cc' ? 'Cc' : 'Bcc'}
    </Button>
  );

  // Not a Form: Enter in To or Subject must not send.
  const fields = (
    <div
      className="contents"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        attach([...event.dataTransfer.files]);
      }}
    >
      {scheduled?.sendAt ? (
        <p className="px-(--gutter) pt-3 text-sm text-muted-foreground">Scheduled for {dateTime(scheduled.sendAt)}. A change makes it a draft again.</p>
      ) : scheduled?.sendError ? (
        <p className="px-(--gutter) pt-3 text-sm text-muted-foreground">Not sent as scheduled: {scheduled.sendError}</p>
      ) : null}
      {fromLine}
      <DraftLine label="To" error={wrongOf(draft.to)}>
        <Recipients
          label="To"
          value={draft.to}
          onChange={(to) => change({ to })}
          text={typing.to}
          onText={(to) => setTyping((was) => ({ ...was, to }))}
          suggest={suggest}
          inputRef={toInput}
        />
        {draft.showCc ? null : ask('cc')}
        {draft.showBcc ? null : ask('bcc')}
      </DraftLine>
      {draft.showCc ? lineFor('cc') : null}
      {draft.showBcc ? lineFor('bcc') : null}
      {what.kind === 'reply' && !draft.editSubject ? null : (
        <DraftLine label="Subject">
          <Input bare aria-label="Subject" className="flex-1" value={draft.subject} onChange={(event) => change({ subject: event.target.value })} />
        </DraftLine>
      )}
      <DraftText
        ref={textField}
        aria-label="Message"
        className={inline ? 'min-h-48' : 'min-h-72'}
        value={draft.text}
        onChange={(event) => change({ text: event.target.value })}
      />
      <DraftFiles files={shown} onRemove={detach} />
    </div>
  );
  if (inline)
    return (
      <ReplyBox
        label={title}
        about={about}
        menu={what.kind === 'new' ? null : <AnswerKind what={what} draft={draft} subject={subject ?? ''} onSwitch={switchTo} onChange={change} />}
        actions={actions}
      >
        {fields}
      </ReplyBox>
    );
  return (
    <Panel narrow open onClose={onClose} title={title} actions={actions} focus={first}>
      {fields}
    </Panel>
  );
}
