import type { ReactNode } from 'react';
import { FinePrint } from './fine-print.tsx';
import { Wordmark } from './type.tsx';

/**
 * The first page of someone not signed in: the name, one line set as large as anything gets, then a
 * sentence and the one action. No sheet: it is the whole page. The terms, privacy, security and source at its foot.
 * On a phone all but the name sits at the bottom, so the action is under the thumb.
 */
export function Splash({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="entry mx-auto flex min-h-svh w-full max-w-[64rem] flex-col px-5 md:px-10">
      <header className="pt-8 md:pt-10">
        <Wordmark size="lg" />
      </header>
      <main className="flex flex-1 flex-col justify-end gap-6 pt-16 pb-10 md:justify-center md:gap-12 md:py-16">
        <h1 className="display">{title}</h1>
        {children}
      </main>
      <footer className="flex gap-4 pb-8 text-sm text-muted-foreground">
        <FinePrint source />
      </footer>
    </div>
  );
}
