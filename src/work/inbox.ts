import type { GmailApi } from '../gmail/api.ts';
import { toFacts } from '../gmail/sync.ts';
import { type Account, recordFromInbox } from '../store/accounts.ts';
import { currentDecision } from '../store/decisions.ts';
import { type InboxRun, addListed, advanceInboxRun, goingInboxRun, isGoing } from '../store/inbox.ts';
import { queuedMessage } from '../store/messages.ts';
import { type Decided, type TriageDeps, type TriageReport, deciderFor, emptyReport } from './triage.ts';

/**
 * The most messages one piece of work goes through: about what four model calls at a time get through in a
 * call's time limit on Vercel, and a bound on what one piece can spend.
 */
const SLICE = 250;
/** Model calls at once. One at a time, a few thousand messages would take hours. */
const AT_ONCE = 4;

type Deps = TriageDeps & { api: Pick<GmailApi, 'searchInbox' | 'getMetadata'> };

/**
 * Go on with an inbox run: list what is in the inbox, then decide the next `SLICE` messages as if each had
 * just arrived, `AT_ONCE` at a time, starting nothing after `until`. A message the user answered, one waiting
 * to be carried out, and one decided since the run began are left as they are. Null when the run is no longer going.
 */
export async function continueInboxRun(
  deps: Deps,
  account: Account,
  runId: number,
): Promise<{ from: number; to: number; of: number; report: TriageReport } | null> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const out = () => deps.until !== undefined && now() >= deps.until;
  let run = await goingInboxRun(db, runId);
  if (!run) return null;
  while (!run.listed) {
    if (out()) return { from: run.next, to: run.next, of: run.messages.length, report: emptyReport() };
    const page = await deps.api.searchInbox('', run.pageToken ?? undefined);
    run = await addListed(db, run, page.ids, page.nextPageToken ?? null);
  }

  const report = emptyReport();
  const deciders = await Promise.all(Array.from({ length: AT_ONCE }, () => deciderFor(deps, account, report)));
  const end = Math.min(run.messages.length, run.next + SLICE);
  let next = run.next;
  // An empty inbox is finished at once.
  if (run.messages.length === 0) await advanceInboxRun(db, run, 0, now());
  while (next < end && !out()) {
    // Stopped from the page meanwhile.
    if (next > run.next && !(await isGoing(db, run.id))) break;
    const batch = run.messages.slice(next, Math.min(end, next + AT_ONCE));
    const decided = await Promise.all(batch.map((id, i) => goThrough(deps, deciders[i]!, run, id)));
    // The provider is down: what it was not asked about is asked at the next tick, in order.
    const held = decided.indexOf('held');
    next += held === -1 ? batch.length : held;
    await advanceInboxRun(db, run, next, now());
    if (held !== -1) break;
  }
  await Promise.all(deciders.map((d) => d.done()));
  return { from: run.next, to: next, of: run.messages.length, report };
}

/** One message of a run, decided again unless it is left as it is. */
async function goThrough(deps: Deps, decider: Awaited<ReturnType<typeof deciderFor>>, run: InboxRun, messageId: string): Promise<Decided | 'left'> {
  const { db } = deps;
  const prior = await currentDecision(db, run.accountId, messageId);
  if (prior && (prior.answered || prior.decidedAt >= run.startedAt || (prior.carryOut && prior.outcome === null))) return 'left';
  let listed = await queuedMessage(db, run.accountId, messageId);
  if (!listed) {
    const raw = await deps.api.getMetadata(messageId);
    const facts = raw ? toFacts(run.accountId, raw) : null;
    // Gone, or out of the inbox since the run listed it.
    if (!facts?.labelIds.includes('INBOX')) return 'left';
    await recordFromInbox(db, run.accountId, [facts], !run.acts, (deps.now ?? Date.now)());
    listed = await queuedMessage(db, run.accountId, messageId);
    if (!listed) return 'left';
  }
  // The run's own word on whether to act: Sift was on at the press, and (through `deps.mailbox`) is still on.
  return await decider.decide(
    { ...listed, suggestOnly: !run.acts },
    prior ? { decision: prior.decision, carriedOut: prior.carryOut && prior.outcome === 'done' } : undefined,
  );
}
