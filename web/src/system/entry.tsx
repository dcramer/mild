import type { ReactNode } from 'react';
import { Sheet } from './sheet.tsx';
import { TextLink, Wordmark } from './type.tsx';

/**
 * The one sheet someone sees in place of the dashboard when sign-in cannot start here. The name sits
 * across its top edge, like a label stuck to it; under it the terms and privacy policy.
 */
export function Entry({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[36rem] flex-col justify-center px-5 py-12">
      <div className="relative">
        <h1 className="absolute -top-5 left-6 z-10">
          <Wordmark size="lg" />
        </h1>
        <Sheet className="entry gap-5 px-6 pt-12 pb-6">{children}</Sheet>
      </div>
      <p className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 px-6 text-sm text-muted-foreground">
        <TextLink href="/terms">Terms</TextLink>
        <TextLink href="/privacy">Privacy</TextLink>
      </p>
    </main>
  );
}
