'use client';
import { PreviewCard as Base } from '@base-ui/react/preview-card';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Anchor } from './anchor.tsx';
import { useTouch } from './touch.ts';

/**
 * A link that shows a little about where it goes when the pointer rests on it or it takes focus. The
 * card is a preview only: everything in it is also on the page the link opens, since a touch screen
 * never shows it. `card` is rendered only while open, so it may load what it shows. Without `href` it is
 * plain text inside something that is itself pressed (a row of Inbox), and the card is for the pointer alone.
 */
export function HoverCard({ href, children, card, className }: { href?: string; children: ReactNode; card: ReactNode; className?: string }) {
  if (useTouch())
    return href === undefined ? (
      <span {...(className ? { className } : {})}>{children}</span>
    ) : (
      <Anchor href={href} {...(className ? { className } : {})}>
        {children}
      </Anchor>
    );
  return (
    <Base.Root>
      <Base.Trigger
        delay={350}
        render={href === undefined ? <span /> : <Anchor href={href} />}
        className={cn(href !== undefined && 'underline-offset-4 hover:underline focus-visible:underline', className)}
      >
        {children}
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner sideOffset={6} align="start" className="z-50">
          <Base.Popup className="sheet w-80 max-w-[calc(100vw-2rem)] bg-popover p-4 text-sm outline-none transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none">
            {card}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
