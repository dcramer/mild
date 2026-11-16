import type { ReactNode } from 'react';
import { TextLink, Wordmark } from './type.tsx';

/**
 * The first page of someone not signed in: the name, one line set as large as anything gets, then what
 * shows sift at work and the one action. No sheet: it is the whole page. The terms and privacy at its foot.
 */
export function Splash({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="entry mx-auto flex min-h-svh w-full max-w-[64rem] flex-col px-5 md:px-10">
      <header className="pt-8 md:pt-10">
        <Wordmark size="lg" />
      </header>
      <main className="flex flex-1 flex-col justify-center gap-10 py-16 md:gap-12">
        <h1 className="display">{title}</h1>
        {children}
      </main>
      <footer className="flex gap-4 pb-8 text-sm text-muted-foreground">
        <TextLink href="/terms">Terms</TextLink>
        <TextLink href="/privacy">Privacy</TextLink>
      </footer>
    </div>
  );
}
