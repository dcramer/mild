'use client';
import { ArchiveIcon, CircleHelpIcon, PlusIcon, ShieldAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { Mailbox } from '@/lib/narrowed.ts';
import { ACTIONS, inboxFirst, outcomeName } from '@/lib/words.ts';
import {
  Heads,
  AnswerPicker,
  LabelPick,
  Button,
  FilterGroup,
  ListPage,
  ListView,
  Hint,
  Marked,
  Meter,
  OnPhone,
  PageHeader,
  RowActions,
  RowCheck,
  RowPresses,
  More,
  Pager,
  Section,
  Sheet,
  Sub,
  Table,
  Td,
  TextLink,
  Th,
  Tooltip,
  Tr,
  TrGroup,
  useToast,
} from '@/system';
import { LABELS, ROWS } from './samples.tsx';

/** Pages of many of one thing, and the rows they list; a row opens the panel. */
export function Lists({
  search,
  setSearch,
  labelled,
  setLabelled,
  setPanel,
}: {
  search: string;
  setSearch: (search: string) => void;
  labelled: string;
  setLabelled: (labelled: string) => void;
  setPanel: (open: boolean) => void;
}) {
  const toast = useToast();
  const [shown, setShown] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [made, setMade] = useState('');
  const [offset, setOffset] = useState(0);
  return (
    <>
      <Section title="Page header and section" meta="the top of a page about one thing, and the parts under it; the second narrowed to one mailbox">
        <Sheet className="gap-8 p-5">
          <PageHeader title="Ada Lovelace" meta="ada@example.org" actions={<Button>Write to them</Button>} />
          <Mailbox value="ada@work.example.org">
            <PageHeader title="news.example.com" />
          </Mailbox>
          <Section title="Proposed rules" meta="2" action={<TextLink href="/system">See all</TextLink>}>
            <p className="text-muted-foreground">A section’s content. No rule or box sets it apart, only space.</p>
          </Section>
        </Sheet>
      </Section>

      <Section
        title="List page, list view"
        meta="how every screen shows many of one thing: the page drawn on the server, the list in it; on a desktop the rail names it, and its action ends the bar"
      >
        <Sheet className="p-5">
          <ListPage title="For review">
            <ListView
              search={{ value: search, onChange: setSearch, placeholder: 'Search' }}
              filters={{
                active: made === '' ? [] : [{ label: `Then: ${outcomeName(made)}`, clear: () => setMade('') }],
                panel: (
                  <>
                    <FilterGroup label="Label" value={labelled} options={[['', 'Any'], null, ...inboxFirst(LABELS)]} onChange={setLabelled} />
                    <FilterGroup label="Then" value={made} options={[['', 'Anything'], ...ACTIONS]} onChange={setMade} />
                  </>
                ),
              }}
            >
              <Table keys>
                <Heads>
                  <Th>Sender</Th>
                  <Th phone="hide">Subject</Th>
                  <Th>Label</Th>
                </Heads>
                <tbody>
                  {ROWS.filter((row) => (made === '' || row.does === made) && `${row.sender} ${row.subject}`.toLowerCase().includes(search.toLowerCase())).map(
                    (row) => (
                      <Tr key={row.address} onOpen={() => setPanel(true)}>
                        <Td className="max-w-0 md:w-1/3">
                          <span className="name block truncate">{row.sender}</span>
                          <Sub>{row.address}</Sub>
                          <OnPhone>
                            <span className="w-full truncate">{row.subject}</span>
                          </OnPhone>
                        </Td>
                        <Td phone="hide" className="max-w-0 md:w-full">
                          <span className="block truncate">
                            <Marked text={row.subject} term={search} />
                          </span>
                        </Td>
                        <RowActions phone="keep">
                          <AnswerPicker
                            className="w-60"
                            label="What this message is"
                            value={row.label === null ? null : (LABELS.find(([, name]) => name === row.label)?.[0] ?? null)}
                            groups={[
                              LABELS.slice(0, 1).map(([id, name]) => ({ id, label: name, ...(row.does === 'keep' ? { lead: <Meter level={3} /> } : {}) })),
                              LABELS.slice(1, 3).map(([id, name], i) => ({ id, label: name, lead: <Meter level={i === 0 ? 3 : 1} /> })),
                              LABELS.slice(3).map(([id, name]) => ({ id, label: name })),
                            ]}
                            empty={outcomeName('review')}
                            ending={{ onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') }}
                            onSubmit={(id) => toast(`Answered: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`)}
                          />
                        </RowActions>
                      </Tr>
                    ),
                  )}
                </tbody>
              </Table>
              <Pager offset={offset} size={50} total={120} onGo={setOffset} />
            </ListView>
          </ListPage>
        </Sheet>
        <p className="text-muted-foreground">
          On a phone the table keeps its first column; what the others said moves under it, and the row opens for the rest.
        </p>
        <Sheet className="p-5">
          <Mailbox value="ada@work.example.org">
            <ListPage
              title="Labels"
              actions={
                <Button>
                  <PlusIcon aria-hidden />
                  Add labels
                </Button>
              }
            >
              <ListView>
                <p className="text-muted-foreground">A list with no search: the mailbox and the action on a line of their own over it.</p>
              </ListView>
            </ListPage>
          </Mailbox>
        </Sheet>
      </Section>

      <Section title="A log" meta="a few ways to see the list; one table, a heading for each day">
        <Sheet className="p-5">
          <ListPage title="Activity">
            <ListView
              view={{
                label: 'Show',
                value: shown,
                options: [
                  ['', 'Changed'],
                  ['all', 'Everything'],
                ],
                onChange: setShown,
              }}
            >
              <Table keys>
                <Heads>
                  <Th>Sender</Th>
                  <Th phone="hide">Subject</Th>
                  <Th phone="hide">What happened</Th>
                </Heads>
                {(
                  [
                    ['Today', ROWS.slice(0, 2)],
                    ['Yesterday', ROWS.slice(2, 3)],
                  ] as const
                ).map(([day, rows]) => (
                  <tbody key={day}>
                    <TrGroup title={day} span={3} />
                    {rows.map((row) => (
                      <Tr key={row.address} onOpen={() => setPanel(true)}>
                        <Td className="max-w-0 md:w-1/3">
                          <span className="name block truncate">{row.sender}</span>
                        </Td>
                        <Td phone="hide" quiet className="max-w-0 md:w-full">
                          <span className="block truncate">{row.subject}</span>
                        </Td>
                        <Td phone="hide" className="whitespace-nowrap">
                          <span className="font-semibold">Archived</span>
                          <span className="text-muted-foreground"> · {row.label ?? 'Newsletters'}</span>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                ))}
              </Table>
            </ListView>
          </ListPage>
        </Sheet>
      </Section>

      <Section
        title="Rows to select"
        meta="dense: a line of small type each; a check on each row (X on the one the keys are on), which fills it; what to do with them takes the search's place, with a check that selects every row and a menu for what is seldom wanted; pointed at, a row's presses take its time's place; more rows load as the end is reached; words typed can be asked"
      >
        <Sheet className="p-5">
          <ListPage title="Inbox">
            <ListView
              search={{
                value: search,
                onChange: setSearch,
                placeholder: 'Search',
                ask: { onAsk: () => toast('Asks the model to make filters of the words'), busy: false },
              }}
              selected={{
                count: picked.size,
                clear: () => setPicked(new Set()),
                all: { total: ROWS.length, select: () => setPicked(new Set(ROWS.map((row) => row.address))) },
                actions: [
                  { label: 'Archive', key: 'e', onPress: () => toast(`Archived ${picked.size}`) },
                  { label: 'Mark read', key: 'Shift+i', onPress: () => toast(`Marked ${picked.size} read`) },
                  { label: 'Mark unread', key: 'Shift+u', onPress: () => toast(`Marked ${picked.size} unread`), tucked: true },
                ],
              }}
            >
              <Table keys dense>
                <Heads>
                  <Th phone="hide">Select</Th>
                  <Th>From</Th>
                  <Th phone="hide">Subject</Th>
                  <Th phone="hide">Received</Th>
                </Heads>
                <tbody>
                  {ROWS.map((row, index) => (
                    <Tr key={row.address} selected={picked.has(row.address)} onOpen={() => setPanel(true)}>
                      <RowCheck
                        label={`Select ${row.subject}`}
                        checked={picked.has(row.address)}
                        onChange={(on) => setPicked((was) => new Set(on ? [...was, row.address] : [...was].filter((a) => a !== row.address)))}
                      />
                      <Td className="max-w-0 md:w-1/3">
                        <span className="name block truncate">{row.sender}</span>
                      </Td>
                      <Td phone="hide" className="max-w-0 md:w-full">
                        <span className="block truncate">{row.subject}</span>
                      </Td>
                      <RowPresses
                        lead={
                          <LabelPick
                            label={`What ${row.subject} is`}
                            value={row.label === null ? null : (LABELS.find(([, name]) => name === row.label)?.[0] ?? null)}
                            groups={[
                              LABELS.slice(0, 1).map(([id, name]) => ({ id, label: name })),
                              LABELS.slice(1, 2).map(([id, name]) => ({ id, label: name, lead: <Meter level={3} /> })),
                              LABELS.slice(2).map(([id, name]) => ({ id, label: name })),
                            ]}
                            onSubmit={async (id) => toast(`Saved: ${LABELS.find(([key]) => key === id)?.[1] ?? id}`)}
                            ending={{ onAdd: () => toast('Opens adding a label'), onRule: () => toast('Opens the rule dialog') }}
                          />
                        }
                        mark={row.label === null ? <Hint icon={CircleHelpIcon} says="Unlabelled" tone="look" /> : null}
                        presses={
                          <>
                            <Tooltip says="Archive">
                              <Button variant="bare" size="tray" aria-label="Archive" onClick={() => toast(`Archived ${row.subject}`)}>
                                <ArchiveIcon aria-hidden />
                              </Button>
                            </Tooltip>
                            <Tooltip says="Spam">
                              <Button variant="bare" size="tray" aria-label="Spam" onClick={() => toast(`Marked ${row.subject} as spam`)}>
                                <ShieldAlertIcon aria-hidden />
                              </Button>
                            </Tooltip>
                          </>
                        }
                      >
                        {`${9 - index}:12 AM`}
                      </RowPresses>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <More onReach={() => {}} />
            </ListView>
          </ListPage>
        </Sheet>
      </Section>
    </>
  );
}
