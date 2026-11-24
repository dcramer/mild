'use client';
import { NamedLabel } from '@/components/bits.tsx';
import { NameCell, SenderCell, senderHref } from '@/components/sender.tsx';
import type { SenderPage } from '@/lib/api/endpoints.ts';
import { count, dateTime, percent } from '@/lib/format.ts';
import { useGo } from '@/lib/params.ts';
import { reveal } from '@/lib/reveal.ts';
import { type RuleStart, messageStart, nameStart } from '@/lib/rule-start.ts';
import { doesName, outcomeName } from '@/lib/words.ts';
import { Ago, Button, Heads, OnPhone, RowActions, Share, Table, Td, Th, Tr } from '@/system';

/** Everyone at a domain who has written, each to their own page. */
export function People({ senders }: { senders: SenderPage['senders'] }) {
  const go = useGo();
  return (
    <Table>
      <Heads shown="always">
        <Th>Name</Th>
        <Th num>Messages</Th>
        <Th phone="hide" num>
          Latest
        </Th>
      </Heads>
      <tbody>
        {senders.map((sender) => (
          <Tr key={reveal(sender.address)} onOpen={() => go(senderHref(reveal(sender.address)))}>
            <SenderCell address={reveal(sender.address)} name={reveal(sender.name)} contact={sender.contact} />
            <Td num className="md:w-full">
              {count(sender.messages)}
            </Td>
            <Td phone="hide" num quiet says={dateTime(sender.lastSeenAt)}>
              <Ago at={sender.lastSeenAt} />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** What their mail is, label by label, each with a rule to start on it. */
export function Labels({ data, onStart }: { data: SenderPage; onStart: (s: RuleStart) => void }) {
  const whole = data.profile.labels.reduce((sum, l) => sum + l.messages, 0);
  return (
    <Table>
      <Heads>
        <Th>Label</Th>
        <Th phone="hide">Share</Th>
        <Th num>Messages</Th>
        <Th>Rule</Th>
      </Heads>
      <tbody>
        {data.profile.labels.map((label) => (
          <Tr key={label.id}>
            <Td className="font-medium whitespace-nowrap">
              <NamedLabel id={label.id}>{label.name}</NamedLabel>
            </Td>
            <Td phone="hide" className="w-full">
              <Share part={label.messages} whole={whole} />
            </Td>
            <Td num className="whitespace-nowrap">
              {count(label.messages)} <span className="text-muted-foreground">· {percent(label.messages, whole)}</span>
            </Td>
            <RowActions>
              <Button variant="quiet" onClick={() => onStart(messageStart(reveal(data.profile.address), label.id))}>
                Make a rule…
              </Button>
            </RowActions>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

type Named = SenderPage['names'][number];

/** What a name's mail is: its labels, most first, then what rules did to the rest, then whether some has none yet. */
function NameIs({ name }: { name: Named }) {
  const placed = [...name.labels, ...name.actions];
  const unplaced = name.messages - placed.reduce((sum, l) => sum + l.messages, 0);
  const words = [...name.labels.map((l) => l.name), ...name.actions.map((a) => doesName(null, a.action)), ...(unplaced > 0 ? [outcomeName('review')] : [])];
  return <span className={placed.length === 0 ? 'text-muted-foreground' : ''}>{words.join(' · ')}</span>;
}

/** Each name an address writes under, what its mail is, and a rule started on that name. */
export function Names({ data, onStart }: { data: SenderPage; onStart: (s: RuleStart) => void }) {
  const whole = data.names.reduce((sum, n) => sum + n.messages, 0);
  return (
    <Table>
      <Heads>
        <Th>Name</Th>
        <Th phone="hide">Share</Th>
        <Th phone="hide" num>
          Messages
        </Th>
        <Th phone="hide">What it is</Th>
        <Th>Rule</Th>
      </Heads>
      <tbody>
        {data.names.map((n) => (
          <Tr key={reveal(n.name) ?? ''}>
            <NameCell address={reveal(data.profile.address)} name={reveal(n.name)}>
              <OnPhone>
                <NameIs name={n} />
                <span>{count(n.messages)}</span>
              </OnPhone>
            </NameCell>
            <Td phone="hide" className="w-full">
              <Share part={n.messages} whole={whole} />
            </Td>
            <Td phone="hide" num className="whitespace-nowrap">
              {count(n.messages)} <span className="text-muted-foreground">· {percent(n.messages, whole)}</span>
            </Td>
            <Td phone="hide" className="whitespace-nowrap">
              <NameIs name={n} />
            </Td>
            <RowActions phone="keep">
              {n.name === null ? null : (
                <Button
                  variant="quiet"
                  onClick={() => n.name !== null && onStart(nameStart(reveal(data.profile.address), reveal(n.name), n.labels[0]?.id ?? null))}
                >
                  Make a rule…
                </Button>
              )}
            </RowActions>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
