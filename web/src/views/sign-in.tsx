import { Button } from '@/components/ui/button';
import type { Session } from '@/lib/api.ts';

/** The only thing an unsigned-in visitor sees. Signing in with Google also connects that Gmail account to sift. */
export function SignInScreen({ session, error }: { session: Session; error: string | null }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="wordmark">
        <span className="hl mx-0 px-2 py-0.5">sift</span>
      </h1>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {session.canSignIn ? (
        <>
          <Button size="lg" className="self-start" render={<a href="/auth/login" />}>
            Sign in with Google
          </Button>
          <p className="text-[13px] text-muted-foreground">
            This is also what lets sift read the account. If Google reports a redirect mismatch, add this to the client's authorised redirect URIs:
            <code className="mt-1 block font-mono text-xs break-all text-foreground">{session.redirectUri}</code>
          </p>
        </>
      ) : session.reason === 'no-client' ? (
        <p className="text-sm">
          No Google client is set up. Run <code className="font-mono">sift init</code> on the machine running sift.
        </p>
      ) : session.reason === 'desktop-client' ? (
        <p className="text-sm">
          Your Google client is a Desktop app client, which Google only allows at localhost. Run <code className="font-mono">sift init</code> and create a Web
          application client with this redirect URI:
          <code className="mt-1 block font-mono text-xs break-all">{session.redirectUri}</code>
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>Google only signs people in at localhost or an HTTPS address. Open sift at one of these:</p>
          <ul className="flex flex-col gap-1">
            {session.addresses.map((address) => (
              <li key={address}>
                <a className="font-mono underline underline-offset-2" href={address}>
                  {address}
                </a>
              </li>
            ))}
          </ul>
          {session.addresses.some((a) => a.startsWith('https://')) ? (
            <p className="text-[13px] text-muted-foreground">
              The HTTPS one needs <code className="font-mono">tailscale serve --bg {window.location.port || '8787'}</code> run once on that machine.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
