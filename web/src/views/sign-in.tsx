import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Session } from '@/lib/api.ts';
import { Button, Code, Copyable, Disclosure, Note, Sheet, Wordmark } from '@/system';

/** The only thing an unsigned-in visitor sees. Signing in with Google also connects that Gmail account to sift. */
export function SignInScreen({ session, error }: { session: Session; error: string | null }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[27rem] flex-col justify-center px-5 py-12">
      <div className="relative">
        {/* The name sits across the sheet's top edge, like a label stuck to it. */}
        <h1 className="absolute -top-5 left-6 z-10">
          <Wordmark size="lg" />
        </h1>
        <Sheet className="gap-5 px-6 pt-12 pb-6">
          {error ? (
            <Note tone="failure" title="Not signed in">
              <p>{error}</p>
            </Note>
          ) : null}
          {session.canSignIn ? <Ready session={session} /> : <Blocked session={session} />}
        </Sheet>
      </div>
    </main>
  );
}

function Ready({ session }: { session: Session }) {
  return (
    <>
      <p className="statement">Sign in with the Gmail account you want sorted.</p>
      <p className="text-muted-foreground">Google will ask you to let sift read, label and archive that account's mail. sift cannot send, and never deletes.</p>
      <Button variant="mark" size="lg" href="/auth/login" className="mt-1 justify-between">
        Sign in with Google
        <ArrowRightIcon aria-hidden />
      </Button>
      <div className="mt-1 border-t border-dashed border-(--rule) pt-4">
        <Disclosure summary="Google says redirect_uri_mismatch">
          <p>Add this to the client's authorised redirect URIs, in Google Cloud:</p>
          <Copyable value={session.redirectUri} label="redirect URI" />
        </Disclosure>
      </div>
    </>
  );
}

/** Why sign-in cannot start here, and the one thing that fixes it. */
function Blocked({ session }: { session: Session }) {
  if (session.reason === 'address') {
    const port = window.location.port || '8787';
    return (
      <>
        <p className="statement">Google won't sign you in at this address.</p>
        <p className="text-muted-foreground">It only returns to localhost or to HTTPS. Open sift at one of these instead:</p>
        <div className="flex flex-col gap-2">
          {session.addresses.map((address) => (
            <Button key={address} href={address} className="justify-between font-mono text-[13px] font-medium">
              {address.replace(/^https?:\/\//, '')}
              <ArrowRightIcon aria-hidden />
            </Button>
          ))}
        </div>
        {session.addresses.some((a) => a.startsWith('https://')) ? (
          <Step>
            <p>The HTTPS address needs this run once, on the machine running sift:</p>
            <Copyable value={`sudo tailscale serve --bg ${port}`} label="command" />
          </Step>
        ) : null}
      </>
    );
  }
  if (session.reason === 'desktop-client') {
    return (
      <>
        <p className="statement">This Google client can't sign you in.</p>
        <p className="text-muted-foreground">It is a Desktop app client. Setup replaces it with a Web application one:</p>
        <Copyable value="sift init" label="command" />
        <Step>
          <p>The new client needs this redirect URI:</p>
          <Copyable value={session.redirectUri} label="redirect URI" />
        </Step>
      </>
    );
  }
  return (
    <>
      <p className="statement">No Google client yet.</p>
      <p className="text-muted-foreground">
        sift signs you in through a Google client you own. Create one with <Code>sift init</Code>, on the machine running sift:
      </p>
      <Copyable value="sift init" label="command" />
    </>
  );
}

function Step({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-t border-dashed border-(--rule) pt-4 text-[13px] text-muted-foreground">{children}</div>;
}
