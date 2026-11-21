import type { DecisionRow } from '@/lib/api.ts';
import { INBOX_NAME, type Status, STATUS_NAMES, doesName, outcomeName, status } from '@/lib/format.ts';
import { Does, Note, Sub, Tooltip } from '@/system';

/**
 * What Mild says mail is and does with it, the same words everywhere: "Archive as Marketing", or "Leave in
 * inbox", which is said alone. In a table cell (`stacked`) the label goes on a quieter second line. With no
 * label and nothing done, Mild was not sure, which is the reader's to answer, so it is the yellow one.
 */
export function Verdict({
  labelId,
  labelName,
  disposition,
  stacked,
}: {
  labelId: string | null;
  labelName: string | null;
  disposition: string;
  stacked?: boolean;
}) {
  if (labelName === null && disposition === 'review') return <Does action="review">{outcomeName('review')}</Does>;
  const alone = doesName(labelId, disposition) === INBOX_NAME;
  const does = <Does action={disposition}>{doesName(labelId, disposition)}</Does>;
  const label = alone ? null : labelName;
  if (stacked)
    return (
      <>
        {does}
        {label ? <Sub>{label}</Sub> : null}
      </>
    );
  return (
    <span>
      {does}
      {label ? <span className="text-muted-foreground"> as {label}</span> : null}
    </span>
  );
}

/** Where a decision has got to in Gmail, in a word. */
export function StatusWord({ row }: { row: Pick<DecisionRow, 'carryOut' | 'outcome' | 'actionStatus' | 'outcomeDetail'> }) {
  const s: Status = status(row);
  return (
    <Tooltip says={row.outcomeDetail} className="text-muted-foreground">
      {STATUS_NAMES[s]}
    </Tooltip>
  );
}

/** Mild refused or failed; what was on screen stays. Mild not answering at all is the masthead's. */
export function ErrorNote({ message }: { message: string }) {
  return (
    <Note tone="failure" title="Could not refresh">
      <p>{message}</p>
    </Note>
  );
}
