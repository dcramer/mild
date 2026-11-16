import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Session } from '@/lib/api.ts';
import { Verdict } from '@/components/bits.tsx';
import { Button, Code, Copyable, Does, Entry, Look, Meter, Note, OnPhone, Splash, Sub, Table, Td, Tr } from '@/system';

/** The only thing an unsigned-in visitor sees. Signing in with Google also connects that Gmail account to sift. */
export function SignInScreen({ session, error }: { session: Session; error: string | null }) {
  const failed = error ? (
    <Note tone="failure" title="Not signed in">
      <p>{error}</p>
    </Note>
  ) : null;
  if (session.canSignIn)
    return (
      <Splash title="Gmail, sifted.">
        <Examples />
        {failed}
        <div>
          <Button variant="mark" size="lg" href="/auth/login" className="w-full justify-between gap-8 sm:w-auto">
            Sign in with Google
            <ArrowRightIcon aria-hidden />
          </Button>
          <p className="mt-3 text-sm text-muted-foreground">It can read, label and archive. It never deletes.</p>
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

// Mail Gmail lets through, and what sift would say about it. Forwarding is not built yet (TODO.md, custom actions).
const EXAMPLES = [
  { from: 'Jordan at Acme Data', subject: 'Quick question about your hiring plans', label: 'Cold outreach', does: 'archive', sure: 3 },
  { from: 'Morgan Lee', subject: 'Bumping this to the top of your inbox', label: 'Cold outreach', does: 'archive', sure: 2 },
  { from: 'Billing Support', subject: 'Payment declined: confirm your account today', label: 'Phishing', does: 'forward', sure: 3 },
  { from: 'Ada Lovelace', subject: 'Lunch Thursday?', label: 'Personal', does: 'keep', sure: 3 },
  { from: 'Riley Chen', subject: 'Intro: you two should meet', label: null, does: 'review', sure: 1 },
] as const;

function Examples() {
  return (
    <div>
      <Table>
        <tbody>
          {EXAMPLES.map((m) => (
            <Tr key={m.subject}>
              <Td className="max-w-0 md:w-[28%]">
                <span className="flex items-baseline gap-3">
                  <span className="name min-w-0 flex-1 truncate">{m.from}</span>
                  <span className="shrink-0 text-sm md:hidden">
                    <Said label={m.label} sure={m.sure}>
                      <span className="text-muted-foreground">{m.label}</span>
                    </Said>
                  </span>
                </span>
                <OnPhone>
                  <span className="w-full truncate">{m.subject}</span>
                </OnPhone>
              </Td>
              <Td phone="hide" className="max-w-0 md:w-full">
                <span className="block truncate text-muted-foreground">{m.subject}</span>
              </Td>
              <Td phone="hide" className="whitespace-nowrap">
                <Said label={m.label} sure={m.sure}>
                  {m.does === 'forward' ? (
                    <span>
                      <Does action="forward">Forward to security</Does>
                      <span className="text-muted-foreground"> as {m.label}</span>
                    </span>
                  ) : (
                    <Verdict labelName={m.label} disposition={m.does} />
                  )}
                </Said>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Sub className="mt-4">Nothing changes in Gmail until you turn it on.</Sub>
    </div>
  );
}

/** How sure sift is, then what it said; with no label, the question it leaves to the reader. */
function Said({ label, sure, children }: { label: string | null; sure: 1 | 2 | 3; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Meter level={sure} />
      {label ? children : <Look>Which label?</Look>}
    </span>
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
