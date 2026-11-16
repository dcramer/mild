import { ArchiveIcon, BanIcon, CircleHelpIcon, InboxIcon, ShieldAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const ICONS = { keep: InboxIcon, archive: ArchiveIcon, spam: ShieldAlertIcon, block: BanIcon, review: CircleHelpIcon } as const;

/**
 * What sift does with mail, as its icon and its word: the action alone, never what comes with it
 * (unsubscribing, marking read), which is said where the label or rule is edited. `action` is a key of
 * the vocabulary in `lib/format.ts`. "Not sure" is in yellow: it is left to the reader.
 */
export function Does({ action, children }: { action: string; children: ReactNode }) {
  const Icon = ICONS[action as keyof typeof ICONS] ?? CircleHelpIcon;
  const look = action === 'review';
  return (
    <span className={cn('inline-flex items-center gap-1.5 align-top font-semibold whitespace-nowrap', look && 'text-highlight')}>
      <Icon aria-hidden className={cn('size-4 shrink-0', !look && 'text-muted-foreground')} />
      {children}
    </span>
  );
}
