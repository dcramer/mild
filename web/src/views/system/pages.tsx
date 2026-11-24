'use client';
import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';
import { SiftStatus, UsageDetail } from '@/components/status.tsx';
import {
  BarSlot,
  Heads,
  Button,
  Clause,
  Document,
  Entry,
  Onboarding,
  Splash,
  Cloud,
  FinePrint,
  ListView,
  MailboxSwitch,
  Masthead,
  TabBar,
  PageFoot,
  Rail,
  Rope,
  Section,
  Sheet,
  Table,
  Td,
  TextArea,
  Th,
  Tr,
  useToast,
} from '@/system';
import { USAGE, SPECIMEN_ACCOUNTS, NAV } from './samples.tsx';

/** Column heads, the dashboard's frame, and the pages that stand in its place. */
export function Pages({ search, setSearch }: { search: string; setSearch: (search: string) => void }) {
  const toast = useToast();
  const [mailbox, setMailbox] = useState('');
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const mailboxes = { mailboxes: ['ada@example.org', 'ada@work.example.org'], value: mailbox, onChange: setMailbox };
  const account = {
    name: 'ada@example.org',
    items: [
      { label: 'Settings', onSelect: () => toast('Settings') },
      { label: 'Sign out', onSelect: () => toast('Signed out') },
    ],
  };
  return (
    <>
      <Section title="Column heads" meta="shown where a figure would not say what it is without one">
        <Table>
          <Heads shown="wide">
            <Th>
              <span className="sr-only">Rule</span>
            </Th>
            <Th phone="hide" num says="Messages the rule has decided since it was made">
              Decisions
            </Th>
            <Th phone="hide" num>
              Last used
            </Th>
            <Th phone="hide" num>
              Cost 30D
            </Th>
          </Heads>
          <tbody>
            <Tr>
              <Td className="max-w-0 md:w-full">
                <span className="name">news@example.com</span>
              </Td>
              <Td phone="hide" num>
                4
              </Td>
              <Td phone="hide" num quiet says="Nov 17, 2026, 10:42 AM">
                6 min ago
              </Td>
              <Td phone="hide" num says="31 messages checked">
                $0.42
              </Td>
            </Tr>
          </tbody>
        </Table>
      </Section>

      <Section
        title="Navigation"
        meta="the rail on a desktop; on a phone the masthead, the tab bar and a screen's floating press; the mailbox switch in each, for someone with more than one"
      >
        <div className="hidden gap-6 md:flex">
          <Sheet className="flex h-[38rem]">
            <Rail
              current="system"
              items={NAV}
              aside={<SiftStatus accounts={SPECIMEN_ACCOUNTS} usage={USAGE} plan={null} stacked />}
              mailbox={mailboxes}
              account={account}
              compose={() => {}}
            />
          </Sheet>
          <Sheet className="flex h-[38rem]">
            <Rail current="" items={[]} />
          </Sheet>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div className="w-72">
            <MailboxSwitch {...mailboxes} />
          </div>
        </div>
        <div className="flex flex-col gap-6 md:hidden">
          <Sheet className="px-4">
            <Masthead
              current="system"
              items={NAV}
              aside={<SiftStatus accounts={SPECIMEN_ACCOUNTS} usage={USAGE} plan={null} />}
              detail={<UsageDetail usage={USAGE} plan={null} />}
              mailbox={mailboxes}
              account={account}
              slot={setBar}
            />
            {/* A list's search goes up into the bar. */}
            <BarSlot value={bar}>
              <ListView search={{ value: search, onChange: setSearch, placeholder: 'Search mail' }} filters={{ active: [], panel: null }}>
                {null}
              </ListView>
            </BarSlot>
          </Sheet>
          <Sheet className="px-4">
            <Masthead current="" items={[]} />
          </Sheet>
          {/* Fixed to the foot of the screen, as it is on every phone screen. */}
          <TabBar current="system" items={NAV} compose={() => toast('Opens the composer')} />
        </div>
      </Section>

      <Section title="Document" meta="a page read from top to bottom: /terms, /privacy, /security">
        <Sheet>
          <Document title="Terms of service" updated="November 15, 2026">
            <p>These terms are between you and whoever runs this copy of Mild.</p>
            <Clause title="Your part">
              <ul>
                <li>Sign in only with a Gmail account that is yours.</li>
                <li>Check what Mild suggests before turning it on.</li>
              </ul>
            </Clause>
          </Document>
        </Sheet>
      </Section>

      <Section
        title="FinePrint, PageFoot"
        meta="the terms, privacy and security, on a Mild run as a service: at the foot of every dashboard screen, under the sections in the phone menu, under Splash and Entry"
      >
        <p className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
          <FinePrint />
        </p>
        <FinePrint list />
        <PageFoot />
        <p className="slug text-muted-foreground">Someone's own copy: only the code</p>
        <Cloud value={false}>
          <PageFoot />
        </Cloud>
      </Section>

      <Section title="Entry" meta="the page in place of the dashboard when sign-in cannot start here; centred in the window">
        <div className="sheet [&>main]:min-h-0">
          <Entry>
            <p className="statement">Sign-in is not set up.</p>
            <p className="text-muted-foreground">Mild needs a Google client before anyone can sign in.</p>
            <Button variant="mark" size="lg" className="justify-between">
              Continue
              <ArrowRightIcon aria-hidden />
            </Button>
          </Entry>
        </div>
      </Section>

      <Section title="Onboarding" meta="the page in place of the dashboard while someone sets Mild up: the steps, then the step, centred; scrolls when long">
        <div className="sheet [&>div]:min-h-0">
          <Onboarding
            steps={['Connect a model', 'What you want', 'Your labels', 'Older mail']}
            current={1}
            title="What do you want from Mild?"
            intro="Say it in your own words, and Mild suggests labels for it."
            account={{ name: 'me@example.org', onSettings: () => {}, onSignOut: () => {} }}
          >
            <TextArea aria-label="What do you want from Mild?" className="min-h-24" defaultValue="Get sales pitches out of my inbox." />
            <div>
              <Button variant="mark" size="lg">
                Suggest labels
                <ArrowRightIcon aria-hidden />
              </Button>
            </div>
          </Onboarding>
        </div>
      </Section>

      <Section title="Splash" meta="the first page of someone not signed in: the name, one line set large, the one action">
        <div className="sheet [&>div]:min-h-0">
          <Splash title="Your inbox, without the pesky salespeople." art={<Rope queue={6} />}>
            <Button variant="mark" size="lg" className="self-start">
              Sign in with Google
            </Button>
          </Splash>
        </div>
      </Section>
    </>
  );
}
