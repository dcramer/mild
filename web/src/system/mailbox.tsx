'use client';
import { useContext } from 'react';
import { Mailbox } from '@/lib/narrowed.ts';
import type { MenuGroup } from './menu.tsx';
import { Select } from './select.tsx';
import { cn } from '@/lib/utils';

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

/**
 * Which of the person's mailboxes a message came to, before its address where the reader says whom it went to: the
 * icon its domain's own site gives itself (`icon`, a `data:` address), or the domain's initial where the site has none;
 * nothing yet, in the same room, while `icon` is undefined. The one place colour that is not the system's own is
 * drawn: it is the domain's.
 */
export function MailboxIcon({ address, icon }: { address: string; icon: string | null | undefined }) {
  const face = 'flex size-4 shrink-0 items-center justify-center rounded-[3px]';
  if (icon) return <img alt="" src={icon} className={cn(face, 'object-contain')} />;
  return (
    <span aria-hidden className={cn(face, 'bg-(--fill) font-heading text-label leading-none font-bold text-muted-foreground uppercase')}>
      {icon === null ? (address.split('@')[1] ?? address).charAt(0) : null}
    </span>
  );
}
