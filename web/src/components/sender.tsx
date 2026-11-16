import { MegaphoneIcon, ReplyIcon, SparkleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { type Contact, type SenderProfile, api, useLoaded } from '@/lib/api.ts';
import { CONTACT_SAYS, describeMatch, outcomeName, plural, shortDate } from '@/lib/format.ts';
import { Blank, Fact, Facts, Failure, Hint, HoverCard, Marked, Sub, Td, TextLink } from '@/system';

export const senderHref = (accountId: string, address: string) => `/sender/${encodeURIComponent(accountId)}/${encodeURIComponent(address)}`;
const domainHref = (accountId: string, domain: string) => `/domain/${encodeURIComponent(accountId)}/${encodeURIComponent(domain)}`;

const CONTACT_ICONS = { new: SparkleIcon, mutual: ReplyIcon, 'one-way': MegaphoneIcon } as const;

/** How the owner and a sender know each other, after their name. Someone new is yellow: look at them first. */
export function ContactHint({ contact }: { contact: Contact }) {
  if (!contact) return null;
  return <Hint icon={CONTACT_ICONS[contact]} says={CONTACT_SAYS[contact]} tone={contact === 'new' ? 'look' : 'plain'} />;
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
              <span className="font-medium">{rule.labelName}</span>
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
 * What sift knows about a sender or a domain, as facts: how much they send and
 * what it is, whether the owner writes to them, and the rules about them. `brief` leaves out the rules
 * and the domain, for a preview.
 */
export function SenderFacts({ accountId, profile, brief }: { accountId: string; profile: SenderProfile; brief?: boolean }) {
  const [top, ...others] = profile.labels;
  return (
    <Facts>
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
          <span className="inline-flex items-center gap-2">
            <TextLink href={domainHref(accountId, profile.domain.name)}>{profile.domain.name}</TextLink>
            <ContactHint contact={profile.domain.contact} />
          </span>
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
        <p className="flex items-center gap-2">
          <span className="name truncate">{data.name ?? address}</span>
          <ContactHint contact={data.profile.contact} />
        </p>
        {data.name ? <p className="truncate text-muted-foreground">{address}</p> : null}
      </div>
      <SenderFacts accountId={accountId} profile={data.profile} brief />
    </div>
  );
}

/**
 * A sender, wherever one is named: a link to their page, with a preview of what Sift knows. Inside a row
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

const SENDER_CELL = 'max-w-0 md:w-[24%] md:min-w-52';

/**
 * The first cell of a row of mail: who sent it, by name and address, since a name alone could be anyone.
 * The same in every list of mail. The address drops on a phone; `aside` ends the name's line there, and
 * `children` go under it (an `OnPhone`). `term` marks a search match.
 */
export function SenderCell({
  accountId,
  address,
  name,
  contact,
  term,
  aside,
  children,
}: {
  accountId: string;
  address: string;
  name: string | null;
  contact?: Contact;
  term?: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const marked = (text: string) => <Marked text={text} {...(term ? { term } : {})} />;
  return (
    <Td className={SENDER_CELL}>
      <span className="flex items-baseline gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="name min-w-0 truncate">
            <SenderLink accountId={accountId} address={address}>
              {marked(name ?? address)}
            </SenderLink>
          </span>
          {contact ? <ContactHint contact={contact} /> : null}
        </span>
        {aside}
      </span>
      {name ? <Sub className="hidden md:block">{marked(address)}</Sub> : null}
      {children}
    </Td>
  );
}

/** `SenderCell` while its row is on its way. */
export function SenderCellLoading({ children }: { children?: ReactNode }) {
  return (
    <Td className={SENDER_CELL}>
      <span className="name">
        <Blank />
      </span>
      <Sub className="hidden md:block">
        <Blank />
      </Sub>
      {children}
    </Td>
  );
}
