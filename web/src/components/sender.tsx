import type { ReactNode } from 'react';
import { type SenderProfile, type Standing, api, useLoaded } from '@/lib/api.ts';
import { STANDINGS, describeMatch, outcomeName, plural, shortDate } from '@/lib/format.ts';
import { Fact, Facts, Failure, HoverCard, Stamp, TextLink } from '@/system';

export const senderHref = (accountId: string, address: string) => `/sender/${encodeURIComponent(accountId)}/${encodeURIComponent(address)}`;
export const domainHref = (accountId: string, domain: string) => `/domain/${encodeURIComponent(accountId)}/${encodeURIComponent(domain)}`;

/** Where a sender stands, in a word. */
export function StandingStamp({ standing }: { standing: Standing }) {
  return <Stamp>{STANDINGS[standing]}</Stamp>;
}

/** What sift's rules say about a sender, one per line. */
function Rules({ rules }: { rules: SenderProfile['rules'] }) {
  return (
    <ul className="flex flex-col gap-1">
      {rules.map((rule) => (
        <li key={rule.id}>
          Mail {describeMatch(rule.match)}
          {rule.kind === 'action' ? (
            <>
              : <span className="font-medium">{rule.disposition ? outcomeName(rule.disposition) : 'nothing'}</span>
            </>
          ) : (
            <>
              {rule.kind === 'when-label' ? ', when it is ' : ' is '}
              <span className="font-medium">{rule.labelName ?? 'a removed label'}</span>
              {rule.when ? `, when it is ${rule.when}` : ''}
              {rule.disposition ? ` (${outcomeName(rule.disposition)})` : ''}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What sift knows about a sender or a domain, as facts: where they stand and why, how much they send and
 * what it is, whether the owner writes to them, and the rules about them. `brief` leaves out the rules
 * and the domain, for a preview.
 */
export function SenderFacts({ accountId, profile, brief }: { accountId: string; profile: SenderProfile; brief?: boolean }) {
  const [top, ...others] = profile.labels;
  return (
    <Facts>
      <Fact term="Standing">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <StandingStamp standing={profile.standing} />
          <span className="text-muted-foreground">{profile.why}</span>
        </span>
      </Fact>
      <Fact term="Mail">
        {profile.messages === 0
          ? 'None recorded'
          : `${plural(profile.messages, 'message')}${profile.firstSeenAt ? ` since ${shortDate(profile.firstSeenAt)}` : ''}${
              profile.senders > 1 ? `, from ${plural(profile.senders, 'address', 'addresses')}` : ''
            }`}
      </Fact>
      {top ? (
        <Fact term="Mostly">
          {top.name}
          {others.length > 0 ? (
            <span className="text-muted-foreground">
              ; also{' '}
              {others
                .slice(0, 2)
                .map((l) => l.name)
                .join(', ')}
            </span>
          ) : null}
        </Fact>
      ) : null}
      {profile.userHasWritten === null ? null : <Fact term="You wrote">{profile.userHasWritten ? 'Yes, you have written to them' : 'Never'}</Fact>}
      {!brief && profile.domain ? (
        <Fact term="Domain">
          <TextLink href={domainHref(accountId, profile.domain.name)}>{profile.domain.name}</TextLink>
          <span className="text-muted-foreground"> · {STANDINGS[profile.domain.standing]}</span>
        </Fact>
      ) : null}
      {!brief && profile.rules.length > 0 ? (
        <Fact term={profile.rules.length === 1 ? 'Rule' : 'Rules'}>
          <Rules rules={profile.rules} />
        </Fact>
      ) : null}
    </Facts>
  );
}

function Preview({ accountId, address }: { accountId: string; address: string }) {
  const { data, error } = useLoaded(`sender-${accountId}-${address}`, (signal) => api.sender(accountId, address, signal), 300_000);
  if (error) return <Failure>{error}</Failure>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="name truncate">{data.name ?? address}</p>
        {data.name ? <p className="truncate text-muted-foreground">{address}</p> : null}
      </div>
      <SenderFacts accountId={accountId} profile={data.profile} brief />
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
