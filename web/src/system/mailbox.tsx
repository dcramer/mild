'use client';
import { useContext } from 'react';
import { Mailbox } from '@/lib/narrowed.ts';
import type { MenuGroup } from './menu.tsx';
import { Select } from './select.tsx';

export interface MailboxChoice {
  mailboxes: readonly string[];
  /** `''` for all of them. */
  value: string;
  onChange: (mailbox: string) => void;
}

/**
 * Which of the person's mailboxes the dashboard shows: All mailboxes first, set apart, then each address, as wide as
 * what holds it. Nothing for someone with one. The rail has none: its account menu offers the same choices
 * (`mailboxChoices`).
 */
export function MailboxSwitch({ mailboxes, value, onChange }: MailboxChoice) {
  if (mailboxes.length < 2) return null;
  return (
    <Select
      label={`Mailbox, ${value || 'All mailboxes'}`}
      value={value}
      options={[['', 'All mailboxes'], null, ...mailboxes.map((mailbox) => [mailbox, mailbox] as const)]}
      onChange={onChange}
      wide
    />
  );
}

/** The same choices as a group of the account menu, the one shown ticked. Nothing for someone with one mailbox. */
export function mailboxChoices({ mailboxes, value, onChange }: MailboxChoice): MenuGroup[] {
  if (mailboxes.length < 2) return [];
  const choice = (mailbox: string, label: string) => ({ label, on: value === mailbox, onSelect: () => onChange(mailbox) });
  return [{ group: 'Mailbox', items: [choice('', 'All mailboxes'), ...mailboxes.map((mailbox) => choice(mailbox, mailbox))] }];
}

/** The mailbox the page is narrowed to, beside its title, so a list that looks short says why. */
export function Narrowed() {
  const mailbox = useContext(Mailbox);
  return mailbox ? <span className="text-muted-foreground">{mailbox}</span> : null;
}
