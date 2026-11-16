import type { ReactNode } from 'react';
import { type SenderProfile, type Standing, api, useLoaded } from '@/lib/api.ts';
import { count, shortDate } from '@/lib/format.ts';
import { HoverCard, Stamp } from '@/system';

export const senderHref = (accountId: string, address: string) => `/sender/${encodeURIComponent(accountId)}/${encodeURIComponent(address)}`;
export const domainHref = (accountId: string, domain: string) => `/domain/${encodeURIComponent(accountId)}/${encodeURIComponent(domain)}`;

const NAMES: Record<Standing, string> = { trusted: 'Trusted', known: 'Known', new: 'New', unwanted: 'Unwanted', blocked: 'Blocked' };

/** Where a sender stands. Only what the owner decided is inked; the rest is quiet. */
export function StandingStamp({ standing }: { standing: Standing }) {
  return <Stamp tone={standing === 'trusted' || standing === 'blocked' ? 'ink' : standing === 'unwanted' ? 'tint' : 'outline'}>{NAMES[standing]}</Stamp>;
}

/** What is known about a sender or a domain, in a few lines. */
export function StandingLines({ profile }: { profile: SenderProfile }) {
  const top = profile.labels[0];
  return (
    <ul className="flex flex-col gap-1 text-sm">
      <li className="flex flex-wrap items-center gap-2">
        <StandingStamp standing={profile.standing} />
        <span className="text-muted-foreground">{profile.why}</span>
      </li>
      <li>
        {profile.messages === 0
          ? 'No mail recorded.'
          : `${count(profile.messages)} ${profile.messages === 1 ? 'message' : 'messages'}${profile.firstSeenAt ? ` since ${shortDate(profile.firstSeenAt)}` : ''}${
              profile.senders > 1 ? `, from ${count(profile.senders)} addresses` : ''
            }.`}
      </li>
      {top ? (
        <li className="text-muted-foreground">
          {profile.labels.length === 1
            ? `All ${top.name}.`
            : `Mostly ${top.name}; also ${profile.labels
                .slice(1, 3)
                .map((l) => l.name)
                .join(', ')}.`}
        </li>
      ) : null}
    </ul>
  );
}

function Preview({ accountId, address }: { accountId: string; address: string }) {
  const { data, error } = useLoaded(`sender-${accountId}-${address}`, (signal) => api.sender(accountId, address, signal), 300_000);
  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="name truncate">{data.name ?? address}</p>
        {data.name ? <p className="truncate text-muted-foreground">{address}</p> : null}
      </div>
      <StandingLines profile={data.profile} />
    </div>
  );
}

/**
 * A sender, wherever one is named: a link to their page, with a preview of where they stand. Inside a row
 * that opens on a press, the link takes the press itself.
 */
export function SenderLink({ accountId, address, children, className }: { accountId: string; address: string; children?: ReactNode; className?: string }) {
  return (
    <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <HoverCard href={senderHref(accountId, address)} card={<Preview accountId={accountId} address={address} />} {...(className ? { className } : {})}>
        {children ?? address}
      </HoverCard>
    </span>
  );
}
