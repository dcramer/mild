'use client';
import { ChevronDownIcon } from 'lucide-react';
import type { Draft, Writing } from '@/lib/compose.ts';
import { Menu } from '@/system';

/**
 * A reply's or forward's menu, at the head of its box: what it is, changed to Reply, Reply to all or Forward, and for a
 * reply, its subject to edit and the files of the message it answers to include, as Gmail's reply menu has them.
 */
export function AnswerKind({
  what,
  draft,
  subject,
  onSwitch,
  onChange,
}: {
  what: Exclude<Writing, { kind: 'new' }>;
  draft: Draft;
  /** A reply's subject as it goes unless edited. */
  subject: string;
  onSwitch: (what: Exclude<Writing, { kind: 'new' }>) => void;
  onChange: (next: Partial<Draft>) => void;
}) {
  const shown = what.kind === 'forward' ? 'Forward' : what.all ? 'Reply to all' : 'Reply';
  const kinds = [
    ['Reply', { kind: 'reply', messageId: what.messageId, all: false }],
    ['Reply to all', { kind: 'reply', messageId: what.messageId, all: true }],
    ['Forward', { kind: 'forward', messageId: what.messageId }],
  ] as const;
  return (
    <Menu
      label={`${shown}: change it`}
      trigger={
        <span className="flex h-(--control) items-center gap-1 px-1.5 font-semibold text-foreground">
          {shown}
          <ChevronDownIcon aria-hidden className="size-3.5" />
        </span>
      }
      items={[
        ...kinds.map(([label, other]) => ({ label, on: label === shown, onSelect: () => label !== shown && onSwitch(other) })),
        ...(what.kind === 'reply'
          ? [
              {
                group: 'More',
                items: [
                  { label: 'Edit subject', disabled: draft.editSubject === true, onSelect: () => onChange({ editSubject: true, subject }) },
                  { label: 'Include original attachments', on: draft.withFiles === true, onSelect: () => onChange({ withFiles: !draft.withFiles }) },
                ],
              },
            ]
          : []),
      ]}
    />
  );
}
