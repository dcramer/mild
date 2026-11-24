'use client';
import { useState } from 'react';
import { ClockIcon } from 'lucide-react';
import { dateTime } from '@/lib/format.ts';
import { Button, Dialog, Field, Input, Menu, useNow } from '@/system';

/** The times Gmail offers to send later, from `now`: tomorrow morning and afternoon, and Monday morning unless that is tomorrow's. */
function laterTimes(now: Date): (readonly [string, number])[] {
  const at = (days: number, hour: number) => {
    const day = new Date(now);
    day.setDate(day.getDate() + days);
    day.setHours(hour, 0, 0, 0);
    return day.getTime();
  };
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [['Tomorrow morning', at(1, 8)], ['Tomorrow afternoon', at(1, 13)], ...(toMonday === 1 ? [] : [['Monday morning', at(toMonday, 8)] as const])];
}

/** `ms` as a `datetime-local` input writes it, in this browser's zone. */
const localInput = (ms: number) => {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** Send later: beside Send, the times Gmail offers, and one picked. */
export function ScheduleSend({ onSchedule }: { onSchedule: (at: number) => void }) {
  const [picking, setPicking] = useState(false);
  const [times] = useState(() => laterTimes(new Date()));
  const [picked, setPicked] = useState(() => localInput(times[0][1]));
  const now = useNow();
  const at = new Date(picked).getTime();
  const past = !Number.isFinite(at) || (now !== null && at <= now);
  return (
    <>
      <Menu
        label="Schedule send"
        trigger={
          <span className="flex size-(--control) items-center justify-center">
            <ClockIcon aria-hidden className="size-4" />
          </span>
        }
        heading={<p className="font-medium">Schedule send</p>}
        items={[
          ...times.map(([label, ms]) => ({ label, note: dateTime(ms), onSelect: () => onSchedule(ms) })),
          { label: 'Pick a date and time…', onSelect: () => setPicking(true) },
        ]}
      />
      <Dialog
        open={picking}
        onClose={() => setPicking(false)}
        title="Schedule send"
        footer={
          <>
            <Button variant="ink" disabled={past} {...(past ? { why: 'Choose a time from now on.' } : {})} onClick={() => (setPicking(false), onSchedule(at))}>
              Schedule send
            </Button>
            <Button variant="quiet" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <Field label="Send at">
          <Input type="datetime-local" value={picked} onChange={(event) => setPicked(event.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
