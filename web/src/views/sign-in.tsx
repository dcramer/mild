import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Session } from '@/lib/api.ts';
import { Button, Code, Copyable, Entry, Note, Splash } from '@/system';

/** The only thing an unsigned-in visitor sees. Signing in with Google also connects that Gmail account to sift. */
export function SignInScreen({ session, error }: { session: Session; error: string | null }) {
  const failed = error ? (
    <Note tone="failure" title="Not signed in">
      <p>{error}</p>
    </Note>
  ) : null;
  if (session.canSignIn)
    return (
      <Splash title="Your inbox, without the pesky salespeople.">
        <p className="max-w-[36rem] text-muted-foreground">Sift labels each message and archives the kinds you don't want.</p>
        {failed}
        <div>
          <Button variant="mark" size="lg" href="/auth/login" className="w-full sm:w-auto">
            Sign in with Google
          </Button>
          <p className="mt-3 text-sm text-muted-foreground">It never deletes.</p>
        </div>
      </Splash>
    );
  return (
    <Entry>
      {failed}
      <Blocked session={session} />
    </Entry>
  );
}

/** Why sign-in cannot start here, and the one thing that fixes it. */
function Blocked({ session }: { session: Session }) {
  if (session.reason === 'address') {
    const port = window.location.port || '8787';
    return (
      <>
        <p className="statement">Google won't sign you in at this address.</p>
        <p className="text-muted-foreground">It only returns to localhost or to HTTPS. Open Sift at one of these instead:</p>
        <div className="flex flex-col gap-2">
          {session.addresses.map((address) => (
            <Button key={address} href={address} className="justify-between font-mono text-sm font-medium">
              {address.replace(/^https?:\/\//, '')}
              <ArrowRightIcon aria-hidden />
            </Button>
          ))}
        </div>
        {session.addresses.some((a) => a.startsWith('https://')) ? (
          <Step>
            <p>The HTTPS address needs this run once, on the machine running Sift:</p>
            <Copyable value={`sudo tailscale serve --bg ${port}`} label="command" />
          </Step>
        ) : null}
      </>
    );
  }
  return (
    <>
      <p className="statement">No Google client yet.</p>
      <p className="text-muted-foreground">
        Sift signs you in through a Google client you own. Create one with <Code>sift init</Code>, on the machine running Sift:
      </p>
      <Copyable value="sift init" label="command" />
    </>
  );
}

function Step({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">{children}</div>;
}
