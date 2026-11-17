import { ArchiveIcon, BanIcon, CircleDashedIcon, CircleHelpIcon, InboxIcon, ShieldAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const ICONS = { keep: InboxIcon, archive: ArchiveIcon, spam: ShieldAlertIcon, block: BanIcon, review: CircleDashedIcon } as const;

/** An action's icon alone, where its word is said beside it by something else, such as an option in a `Select`. */
export function ActionIcon({ action }: { action: string }) {
  const Icon = ICONS[action as keyof typeof ICONS] ?? CircleHelpIcon;
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * What sift does with mail, as its icon and its word: the action alone, never what comes with it
 * (unsubscribing, marking read), which is said where the label or rule is edited. `action` is a key of
 * the vocabulary in `lib/format.ts`. Unlabelled is in quiet ink: it is a question for the reader, not a fault.
 * The icon is the size of its word, so a verdict set as a heading keeps them in step.
 */
export function Does({ action, children }: { action: string; children: ReactNode }) {
  const Icon = ICONS[action as keyof typeof ICONS] ?? CircleHelpIcon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 align-top whitespace-nowrap', action === 'review' ? 'text-muted-foreground' : 'font-semibold')}>
      <Icon aria-hidden className="size-[1em] shrink-0 text-muted-foreground" />
      {children}
    </span>
  );
}
