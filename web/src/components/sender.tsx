'use client';
import { MegaphoneIcon, ReplyIcon, SparkleIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { type Contact, type RuleMatch, type SenderProfile, api, useLoaded } from '@/lib/api.ts';
import { CONTACT_SAYS, INBOX, MATCH_WORDS, type Said, doesName, factAnswers, factWords, outcomeName, plural, saidOf, shortDate } from '@/lib/format.ts';
import { Blank, Fact, Facts, Failure, Hint, HoverCard, Marked, Sub, Td } from '@/system';
import { reveal } from '@/lib/reveal.ts';

/** A sender's page; with `name`, their mail under that name. */
export const senderHref = (accountId: string, address: string, name?: string | null) =>
  `/sender/${encodeURIComponent(accountId)}/${encodeURIComponent(address)}${name ? `?name=${encodeURIComponent(name)}` : ''}`;
const domainHref = (accountId: string, domain: string) => `/domain/${encodeURIComponent(accountId)}/${encodeURIComponent(domain)}`;

const CONTACT_ICONS = { new: SparkleIcon, mutual: ReplyIcon, 'one-way': MegaphoneIcon } as const;

/** How the owner and a sender know each other, after their name. Someone new is yellow: look at them first. */
export function ContactHint({ contact }: { contact: Contact }) {
  if (!contact) return null;
  return <Hint icon={CONTACT_ICONS[contact]} says={CONTACT_SAYS[contact]} tone={contact === 'new' ? 'look' : 'plain'} />;
}

/** What sift's rules say about a sender, one per line. */
function Rules({ accountId, rules }: { accountId: string; rules: SenderProfile['rules'] }) {
  return (
    <ul className="flex flex-col gap-1">
      {rules.map((rule) => (
        <li key={rule.id}>
          {reveal(rule.name) ?? (
            <>
              Mail <MatchWords accountId={accountId} match={reveal(rule.match)} />
            </>
          )}
          {rule.kind === 'action' || rule.labelId === INBOX ? (
            <>
              :{' '}
              <span className="font-medium">{rule.disposition || rule.labelId === INBOX ? doesName(rule.labelId, rule.disposition ?? 'keep') : 'nothing'}</span>
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
            <DomainLink accountId={accountId} domain={reveal(profile.domain.name)} />
            <ContactHint contact={profile.domain.contact} />
          </span>
        </Fact>
      ) : null}
      {!brief && profile.rules.length > 0 ? (
        <Fact term={profile.rules.length === 1 ? 'Rule' : 'Rules'}>
          <Rules accountId={accountId} rules={profile.rules} />
        </Fact>
      ) : null}
    </Facts>
  );
}

type Who = { address: string } | { domain: string };

function Preview({ accountId, who }: { accountId: string; who: Who }) {
  const key = 'address' in who ? who.address : who.domain;
  const { data, error } = useLoaded(
    `${'address' in who ? 'sender' : 'domain'}-${accountId}-${key}`,
    (signal) => ('address' in who ? api.sender(accountId, who.address, signal) : api.domain(accountId, who.domain, signal)),
    300_000,
  );
  // A domain anyone can get an address at has no page of its own, and the refusal says so.
  if (error) return 'domain' in who ? <p className="text-muted-foreground">{error}</p> : <Failure>{error}</Failure>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="flex items-center gap-2">
          <span className="name truncate">{reveal(data.name) ?? key}</span>
          <ContactHint contact={data.profile.contact} />
        </p>
        {data.name ? <p className="truncate text-muted-foreground">{key}</p> : null}
      </div>
      <SenderFacts accountId={accountId} profile={data.profile} brief />
    </div>
  );
}

/**
 * A sender, wherever one is named by address or name: a link to their page. A name opens their mail under
 * that name.
 */
export function SenderLink({
  accountId,
  address,
  name,
  children,
  className,
}: {
  accountId: string;
  address: string;
  name?: string | null;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <HoverCard href={senderHref(accountId, address, name)} card={<Preview accountId={accountId} who={{ address }} />} {...(className ? { className } : {})}>
      {children ?? name ?? address}
    </HoverCard>
  );
}

/** A domain, wherever one is named: a link to its page. */
export function DomainLink({ accountId, domain, className }: { accountId: string; domain: string; className?: string }) {
  return (
    <HoverCard href={domainHref(accountId, domain)} card={<Preview accountId={accountId} who={{ domain }} />} {...(className ? { className } : {})}>
      {domain}
    </HoverCard>
  );
}

/** One value of a rule's match: an address and a domain link to their pages, and so does a name said beside one address. */
export function MatchValue({ accountId, match, said }: { accountId: string; match: RuleMatch; said: Said }) {
  if (said.key === 'from') return <SenderLink accountId={accountId} address={said.plain} />;
  if (said.key === 'fromDomain') return <DomainLink accountId={accountId} domain={said.plain} />;
  const [only, ...more] = match.from ?? [];
  if (said.key === 'fromName' && only && more.length === 0)
    return (
      <SenderLink accountId={accountId} address={only} name={said.plain}>
        {said.value}
      </SenderLink>
    );
  return <>{said.value}</>;
}

/** `describeMatch`, with its senders and domains linked. */
export function MatchWords({ accountId, match }: { accountId: string; match: RuleMatch }) {
  const named = saidOf(match);
  const asked = factAnswers(match.facts).map(factWords);
  return (
    <>
      {named.map((said) => (
        <Fragment key={`${said.key} ${said.plain}`}>
          {said.joint}
          {said.first ? `${MATCH_WORDS[said.key]} ` : ''}
          <MatchValue accountId={accountId} match={match} said={said} />
        </Fragment>
      ))}
      {asked.length > 0 ? `${named.length > 0 ? ', ' : ''}that ${asked.join(' and ')}` : null}
    </>
  );
}

/** The width of the first column of a list of mail. */
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
            <SenderLink accountId={accountId} address={address} name={name}>
              {marked(name ?? address)}
            </SenderLink>
          </span>
          {contact ? <ContactHint contact={contact} /> : null}
        </span>
        {aside}
      </span>
      {name ? (
        <Sub className="hidden md:block">
          <SenderLink accountId={accountId} address={address}>
            {marked(address)}
          </SenderLink>
        </Sub>
      ) : null}
      {children}
    </Td>
  );
}

/** `SenderCell` on an address's own page, where only the name tells its mail apart: the name, a link to their mail under it. */
export function NameCell({ accountId, address, name, children }: { accountId: string; address: string; name: string | null; children?: ReactNode }) {
  return (
    <Td className={SENDER_CELL}>
      <span className="name block truncate">
        {name === null ? (
          <span className="font-normal text-muted-foreground">No name</span>
        ) : (
          <SenderLink accountId={accountId} address={address} name={name} />
        )}
      </span>
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
