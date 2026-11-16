import type { ReactNode } from 'react';
import { Sheet } from './sheet.tsx';
import { TextLink, Wordmark } from './type.tsx';

/**
 * The one sheet someone sees in place of the dashboard until they can use it: signing in, then connecting
 * a model. The name sits across its top edge, like a label stuck to it. Under it, once someone is signed
 * in, who, their settings and a way out, since nothing else on the page leads anywhere; then the terms
 * and privacy policy.
 */
export function Entry({ children, account }: { children: ReactNode; account?: { name: string; onSettings: () => void; onSignOut: () => void } }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[36rem] flex-col justify-center px-5 py-12">
      <div className="relative">
        <h1 className="absolute -top-5 left-6 z-10">
          <Wordmark size="lg" />
        </h1>
        <Sheet className="gap-5 px-6 pt-12 pb-6">{children}</Sheet>
      </div>
      <p className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 px-6 text-sm text-muted-foreground">
        {account ? (
          <>
            <span className="min-w-0 truncate">{account.name}</span>
            <Press onPress={account.onSettings}>Settings</Press>
            <Press onPress={account.onSignOut}>Sign out</Press>
          </>
        ) : null}
        <TextLink href="/terms">Terms</TextLink>
        <TextLink href="/privacy">Privacy</TextLink>
      </p>
    </main>
  );
}

function Press({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onPress} className="cursor-pointer underline decoration-foreground/35 underline-offset-[0.2em] hover:decoration-foreground">
      {children}
    </button>
  );
}
