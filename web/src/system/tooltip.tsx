'use client';
import { Tooltip as Base } from '@base-ui/react/tooltip';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { useTouch } from './touch.ts';

/**
 * A few words more about what it wraps, shown when the pointer rests on it. Never on a touch screen, so
 * it only adds to what the page says: an exact time behind "11 h ago", what a figure counts. Whatever a
 * reader on a phone needs is said where a tap reaches it, such as the panel a row opens.
 */
export function Tooltip({ says, children, className, side }: { says: ReactNode; children: ReactNode; className?: string; side?: 'top' | 'right' | undefined }) {
  const touch = useTouch();
  if (touch || says === null || says === undefined || says === '') return <span className={className}>{children}</span>;
  return (
    <Base.Root>
      <Base.Trigger delay={350} render={<span className={className} />}>
        {children}
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner side={side} sideOffset={6} className="z-50">
          <Base.Popup
            role="tooltip"
            className={cn(
              'sheet max-w-xs bg-popover px-3 py-2 text-sm whitespace-pre-line tabular-nums text-foreground',
              'transition-opacity duration-(--motion-hint) data-ending-style:opacity-0 data-starting-style:opacity-0',
            )}
          >
            {says}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
