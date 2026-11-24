'use client';
import { MegaphoneIcon, ReplyIcon, SparkleIcon } from 'lucide-react';
import { NamedLabel } from '@/components/bits.tsx';
import { Fragment, type ReactNode } from 'react';
import { type Contact, type RuleMatch, type SenderProfile } from '@/lib/api/endpoints.ts';
import {
  CONTACT_SAYS,
  INBOX,
  MATCH_WORDS,
  type Said,
  count,
  describeMatch,
  doesName,
  duration,
  factAnswers,
  factWords,
  outcomeName,
  plural,
  saidOf,
  shortDate,
} from '@/lib/format.ts';
import { rulePath } from '@/lib/params.ts';
import { Ago, Blank, Fact, Facts, Failure, Hint, HoverCard, Marked, Sub, Td, TextLink, LabelName } from '@/system';
import { reveal } from '@/lib/reveal.ts';
import { cn } from '@/lib/utils';
import { useWhoCard } from '@/lib/api/reads.ts';

/** A sender's page; with `name`, their mail under that name. */
export const senderHref = (address: string, name?: string | null) => `/sender/${encodeURIComponent(address)}${name ? `?name=${encodeURIComponent(name)}` : ''}`;
const domainHref = (domain: string) => `/domain/${encodeURIComponent(domain)}`;

const CONTACT_ICONS = { new: SparkleIcon, mutual: ReplyIcon, 'one-way': MegaphoneIcon } as const;

/** How the owner and a sender know each other, after their name, or in words (`said`) under it on their page. Someone new is yellow: look at them first. */
export function ContactHint({ contact, said }: { contact: Contact; said?: boolean }) {
  if (!contact) return null;
  return <Hint icon={CONTACT_ICONS[contact]} says={CONTACT_SAYS[contact]} tone={contact === 'new' ? 'look' : 'plain'} said={said ?? false} />;
}

/** A domain's link with how Mild knows it after it, held to the domain's last letters: a domain wrapped on a phone never leaves it on a line of its own. */
export function DomainNamed({ domain, contact }: { domain: string; contact: Contact }) {
  return (
    <span>
      <DomainLink domain={domain} />
      {contact ? (
        <>
          {'\u00a0'}
          <span className="inline-flex align-[-2px]">
            <ContactHint contact={contact} />
          </span>
        </>
      ) : null}
    </span>
  );
}

/** What Mild's rules say about a sender, one per line. */
function Rules({ rules }: { rules: SenderProfile['rules'] }) {
  return (
    <ul className="flex flex-col gap-1">
      {rules.map((rule) => (
        <li key={rule.id}>
          {reveal(rule.name) ?? (
            <>
              Mail <MatchWords match={reveal(rule.match)} />
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
              <span className="font-medium">
                <LabelName>{rule.labelName}</LabelName>
              </span>
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
 * What Mild knows about a sender or a domain, as facts: how much they send and what it is, whether the owner writes to
 * them, their domain and the rules about them. Their own `page` says the rules, the domain and how they know each other
 * elsewhere, and here how much they sent lately, how much Mild kept out of the inbox and how often it was right.
 */
export function SenderFacts({ profile, page = false }: { profile: SenderProfile; page?: boolean }) {
  const [top, ...others] = profile.labels;
  const { right, wrong } = profile.answers;
  // Their page says how the reader knows them under their name.
  const writtenSaid = page && (profile.contact === 'mutual' || profile.contact === 'one-way');
  return (
    <Facts>
      <Fact term="Mail">
        {profile.messages === 0
          ? 'None recorded'
          : `${plural(profile.messages, 'message')}${profile.firstSeenAt ? ` since ${shortDate(profile.firstSeenAt)}` : ''}${
              profile.senders > 1 ? `, from ${plural(profile.senders, 'address', 'addresses')}` : ''
            }`}
      </Fact>
      {/* Said only where it is not all of their mail, which the line above says. */}
      {page && profile.lastSeenAt !== null && profile.recent < profile.messages ? (
        <Fact term="Last 30 days">
          {count(profile.recent)}, latest <Ago at={profile.lastSeenAt} />
        </Fact>
      ) : null}
      {top ? (
        <Fact term="Mostly">
          <NamedLabel id={top.id}>{top.name}</NamedLabel>
          {others.length > 0 ? (
            <span className="text-muted-foreground">
              ; also{' '}
              {others.slice(0, 2).map((l, i) => (
                <Fragment key={l.name}>
                  {i > 0 ? ', ' : null}
                  <NamedLabel id={l.id}>{l.name}</NamedLabel>
                </Fragment>
              ))}
            </span>
          ) : null}
        </Fact>
      ) : null}
      {profile.userHasWritten === null || writtenSaid ? null : (
        <Fact term="You wrote">{profile.userHasWritten ? 'Yes, you have written to them' : 'Never'}</Fact>
      )}
      {page && profile.saved.messages > 0 ? (
        <Fact term="Kept out">
          {count(profile.saved.messages)} from your inbox, about {duration(profile.saved.seconds)}
        </Fact>
      ) : null}
      {page && right + wrong > 0 ? <Fact term="Mild was right">{`${count(right)} of ${plural(right + wrong, 'time')} you checked`}</Fact> : null}
      {!page && profile.domain ? (
        <Fact term="Domain">
          <DomainNamed domain={reveal(profile.domain.name)} contact={profile.domain.contact} />
        </Fact>
      ) : null}
      {!page && profile.rules.length > 0 ? (
        <Fact term={profile.rules.length === 1 ? 'Rule' : 'Rules'}>
          <Rules rules={profile.rules} />
        </Fact>
      ) : null}
    </Facts>
  );
}

type Who = { address: string } | { domain: string };

type Rule = SenderProfile['rules'][number];

/** A rule in a line of words, as a link to it would say it. */
export function RuleWords({ rule }: { rule: Rule }) {
  const what = reveal(rule.name) ?? `Mail ${describeMatch(reveal(rule.match))}`;
  if (rule.kind === 'action' || rule.labelId === INBOX)
    return `${what}: ${rule.disposition || rule.labelId === INBOX ? doesName(rule.labelId, rule.disposition ?? 'keep') : 'nothing'}`;
  return (
    <>
      {what}
      {rule.kind === 'when-label' ? ', when it is ' : ' is '}
      {rule.labelName ? <LabelName>{rule.labelName}</LabelName> : null}
    </>
  );
}

/** How many names past the one shown a card lists before saying how many more. */
const NAMES_SHOWN = 3;

/**
 * Who a sender or domain is, for a name that says too little: their address, how much they send and what, how you know
 * each other, the other names their address writes under, and the rules that name them. `name` is the one shown where
 * the pointer is.
 */
function Preview({ who, name }: { who: Who; name?: string | null }) {
  const key = 'address' in who ? who.address : who.domain;
  const { data, error } = useWhoCard(who);
  // A domain anyone can get an address at has no page of its own, and the refusal says so.
  if (error) return 'domain' in who ? <p className="text-muted-foreground">{error}</p> : <Failure>{error}</Failure>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;
  const { profile } = data;
  const shown = name ?? reveal(data.name);
  const [top] = profile.labels;
  const others = data.names.flatMap((n) => (n.name === null || reveal(n.name) === shown ? [] : [reveal(n.name)]));
  const href = 'address' in who ? senderHref(who.address) : domainHref(who.domain);
  return (
    <div role="group" aria-label={`About ${shown ?? key}`} className="flex flex-col gap-3">
      <div>
        <TextLink href={href} className="name block truncate">
          {shown ?? key}
        </TextLink>
        {shown ? <p className="truncate text-muted-foreground">{key}</p> : null}
      </div>
      <ul className="flex flex-col gap-1">
        <li>
          {profile.messages === 0 ? (
            'No mail recorded'
          ) : (
            <>
              {plural(profile.messages, 'message')}
              {profile.firstSeenAt ? ` since ${shortDate(profile.firstSeenAt)}` : ''}
              {profile.recent < profile.messages ? <span className="text-muted-foreground">, {count(profile.recent)} in 30 days</span> : null}
            </>
          )}
        </li>
        {profile.senders > 1 ? <li className="text-muted-foreground">From {plural(profile.senders, 'address', 'addresses')}</li> : null}
        {profile.contact ? (
          <li className="text-muted-foreground">
            <ContactHint contact={profile.contact} said />
          </li>
        ) : null}
        {top ? (
          <li>
            Mostly <NamedLabel id={top.id}>{top.name}</NamedLabel>
          </li>
        ) : null}
        {others.length > 0 ? (
          <li className="text-muted-foreground">
            Also writes as {others.slice(0, NAMES_SHOWN).join(', ')}
            {others.length > NAMES_SHOWN ? ` and ${count(others.length - NAMES_SHOWN)} more` : ''}
          </li>
        ) : null}
      </ul>
      {profile.rules.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {profile.rules.map((rule) => (
            <li key={rule.id}>
              <TextLink href={rulePath(rule.id)}>
                <RuleWords rule={rule} />
              </TextLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A sender, wherever one is named by address or name: a link to their page. A name opens their mail under
 * that name.
 */
export function SenderLink({ address, name, children, className }: { address: string; name?: string | null; children?: ReactNode; className?: string }) {
  return (
    <HoverCard href={senderHref(address, name)} card={<Preview who={{ address }} name={name ?? null} />} {...(className ? { className } : {})}>
      {children ?? name ?? address}
    </HoverCard>
  );
}

/** A sender named inside something pressed for another reason (a row of Inbox, which opens the conversation): their card on hover, and no link. */
export function SenderName({ address, name, children }: { address: string; name: string | null; children: ReactNode }) {
  return <HoverCard card={<Preview who={{ address }} name={name} />}>{children}</HoverCard>;
}

/** A domain, wherever one is named: a link to its page. */
function DomainLink({ domain, className }: { domain: string; className?: string }) {
  return (
    <HoverCard href={domainHref(domain)} card={<Preview who={{ domain }} />} {...(className ? { className } : {})}>
      {domain}
    </HoverCard>
  );
}

/** One value of a rule's match: an address and a domain link to their pages, and so does a name said beside one address. */
export function MatchValue({ match, said }: { match: RuleMatch; said: Said }) {
  if (said.key === 'from') return <SenderLink address={said.plain} />;
  if (said.key === 'fromDomain') return <DomainLink domain={said.plain} />;
  const [only, ...more] = match.from ?? [];
  if (said.key === 'fromName' && only && more.length === 0)
    return (
      <SenderLink address={only} name={said.plain}>
        {said.value}
      </SenderLink>
    );
  return <>{said.value}</>;
}

/** `describeMatch`, with its senders and domains linked. */
export function MatchWords({ match }: { match: RuleMatch }) {
  const named = saidOf(match);
  const asked = factAnswers(match.facts).map(factWords);
  return (
    <>
      {named.map((said) => (
        <Fragment key={`${said.key} ${said.plain}`}>
          {said.joint}
          {said.first ? `${MATCH_WORDS[said.key]} ` : ''}
          <MatchValue match={match} said={said} />
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
 * `children` go under it (an `OnPhone`). `term` marks a search match. `line`: the address after the name on one line,
 * for a list of one-line rows (For review), with `messages`, how many the row stands for, after it.
 */
export function SenderCell({
  address,
  name,
  contact,
  term,
  line = false,
  messages,
  aside,
  children,
}: {
  address: string;
  name: string | null;
  contact?: Contact;
  term?: string;
  line?: boolean;
  messages?: number;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const marked = (text: string) => <Marked text={text} {...(term ? { term } : {})} />;
  const at = name ? <SenderLink address={address}>{marked(address)}</SenderLink> : null;
  return (
    <Td className={SENDER_CELL}>
      <span className="flex items-baseline gap-3">
        <span className={cn('flex min-w-0 flex-1 gap-2', line ? 'items-baseline' : 'items-center')}>
          <span className="name min-w-0 shrink-0 truncate md:max-w-[60%]">
            <SenderLink address={address} name={name}>
              {marked(name ?? address)}
            </SenderLink>
          </span>
          {contact ? <ContactHint contact={contact} /> : null}
          {line && at ? <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:inline">{at}</span> : null}
          {messages !== undefined && messages > 1 ? <span className="text-muted-foreground tabular-nums">{messages}</span> : null}
        </span>
        {aside}
      </span>
      {!line && at ? <Sub className="hidden md:block">{at}</Sub> : null}
      {children}
    </Td>
  );
}

/** `SenderCell` on an address's own page, where only the name tells its mail apart: the name, a link to their mail under it. */
export function NameCell({ address, name, children }: { address: string; name: string | null; children?: ReactNode }) {
  return (
    <Td className={SENDER_CELL}>
      <span className="name block truncate">
        {name === null ? <span className="font-normal text-muted-foreground">No name</span> : <SenderLink address={address} name={name} />}
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
