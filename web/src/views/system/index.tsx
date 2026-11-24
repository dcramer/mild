'use client';
import { useState } from 'react';
import { Cloud, PageHeader } from '@/system';
import { Controls } from './controls.tsx';
import { Feedback } from './feedback.tsx';
import { Foundations } from './foundations.tsx';
import { Lists } from './lists.tsx';
import { Overlays } from './overlays.tsx';
import { Pages } from './pages.tsx';
import { Reading } from './reading.tsx';
import { Sheets } from './sheets.tsx';

/** Every part of the design system in every state, at `/system`. Add to it when the system grows. */
export function SystemView() {
  // Shared by the groups: a row opens the panel, one search is a list's and the bar's, one label is a select's and a filter's.
  const [panel, setPanel] = useState(false);
  const [search, setSearch] = useState('');
  const [labelled, setLabelled] = useState('');
  return (
    // Its parts are shown as a service shows them, with the terms, privacy and security in the fine print.
    <Cloud value>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 py-8 md:px-6">
        <PageHeader title="Design system" meta="Every part, in every state. The rules for using them are in docs/design.md." />
        <Foundations />
        <Controls labelled={labelled} setLabelled={setLabelled} />
        <Lists search={search} setSearch={setSearch} labelled={labelled} setLabelled={setLabelled} setPanel={setPanel} />
        <Sheets />
        <Feedback />
        <Pages search={search} setSearch={setSearch} />
        <Reading />
        <Overlays panel={panel} setPanel={setPanel} />
      </main>
    </Cloud>
  );
}
