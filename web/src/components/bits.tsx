import type { DecisionRow } from '@/lib/api.ts';
import { INBOX_NAME, type Status, STATUS_NAMES, doesName, outcomeName, status } from '@/lib/format.ts';
import { Does, Note, Sub } from '@/system';

/**
 * What sift says mail is and does with it, the same words everywhere: "Archive as Marketing", or "Leave in
 * inbox", which is said alone. In a table cell (`stacked`) the label goes on a quieter second line. With no
 * label and nothing done, sift was not sure, which is the reader's to answer, so it is the yellow one.
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
    <span className="text-muted-foreground" title={row.outcomeDetail ?? undefined}>
      {STATUS_NAMES[s]}
    </span>
  );
}

/** Sift refused or failed; what was on screen stays. Sift not answering at all is the masthead's. */
export function ErrorNote({ message }: { message: string }) {
  return (
    <Note tone="failure" title="Could not refresh">
      <p>{message}</p>
    </Note>
  );
}
