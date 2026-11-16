import { ArchiveIcon, BanIcon, CircleHelpIcon, ForwardIcon, InboxIcon, ShieldAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// `forward` is a custom action not built yet (TODO.md); only the sign-in page's examples show it.
const ICONS = { keep: InboxIcon, archive: ArchiveIcon, spam: ShieldAlertIcon, block: BanIcon, review: CircleHelpIcon, forward: ForwardIcon } as const;

/** An action's icon alone, where its word is said beside it by something else, such as an option in a `Select`. */
export function ActionIcon({ action }: { action: string }) {
  const Icon = ICONS[action as keyof typeof ICONS] ?? CircleHelpIcon;
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

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
