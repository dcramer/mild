import type { DatabaseSync } from 'node:sqlite';
import {
  type ActionPayload,
  type ActionRecord,
  type LabelChange,
  finishAction,
  getAction,
  insertPendingAction,
  listOpenActions,
  setActionStatus,
} from '../store/actions.ts';
import type { Mailbox } from './mailbox.ts';

export interface MessageAction {
  /** `label` leaves the message where it is; `archive` and `spam` take it out of the inbox. */
  type: 'label' | 'archive' | 'spam';
  /** Gmail labels to add, by name: what the mail is. */
  labels?: string[];
  /** Also mark the message read. Not for spam. */
  markRead?: boolean;
}

/**
 * What sift did, as a second Gmail label beside the one for what the mail is. Applied here to every
 * archived or spammed message whatever the caller passes, so anything sift moved can be found in Gmail itself.
 */
export const AUDIT_LABELS = { archive: 'sift/did/archived', spam: 'sift/did/spam' } as const;

export type Outcome =
  | { status: 'done'; actionId: number; finalLabels: string[] }
  /** Nothing was attempted. No audit row is written. */
  | { status: 'skipped'; reason: string }
  /** `failed`: the change did not happen. `unknown`: the provider call errored and the result could not be read back. */
  | { status: 'failed' | 'unknown'; actionId: number; reason: string };

export interface ActionDeps {
  db: DatabaseSync;
  mailbox: Mailbox;
  now?: () => number;
}

const clock = (deps: ActionDeps) => (deps.now ?? Date.now)();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const applied = (labels: string[], change: LabelChange) => change.add.every((l) => labels.includes(l)) && !change.remove.some((l) => labels.includes(l));

/**
 * The single path for changing a message: write intent, change, read back, record the outcome.
 * Only the part of `change` that differs from `current` is sent, so unrelated labels and unread state are untouched.
 */
async function applyChange(
  deps: ActionDeps,
  target: { accountId: string; messageId: string; type: string; undoOf?: number; decisionId?: number },
  current: string[],
  requested: LabelChange,
): Promise<Outcome> {
  const change: LabelChange = {
    add: requested.add.filter((l) => !current.includes(l)),
    remove: requested.remove.filter((l) => current.includes(l)),
  };
  if (change.add.length === 0 && change.remove.length === 0) return { status: 'skipped', reason: 'already in the requested state' };

  const payload: ActionPayload = { ...change, ...(target.undoOf === undefined ? {} : { undoOf: target.undoOf }) };
  const actionId = insertPendingAction(
    deps.db,
    {
      accountId: target.accountId,
      messageId: target.messageId,
      type: target.type,
      payload,
      originalLabels: current,
      ...(target.decisionId === undefined ? {} : { decisionId: target.decisionId }),
    },
    clock(deps),
  );

  let finalLabels: string[] | null;
  try {
    await deps.mailbox.modifyLabels(target.messageId, change);
    finalLabels = await deps.mailbox.getLabelIds(target.messageId);
  } catch (error) {
    // The call may or may not have landed. Leave it open; reconcile() settles it from the mailbox's actual state.
    finishAction(deps.db, actionId, 'unknown', null, message(error), clock(deps));
    return { status: 'unknown', actionId, reason: message(error) };
  }

  if (finalLabels && applied(finalLabels, change)) {
    finishAction(deps.db, actionId, 'done', finalLabels, null, clock(deps));
    return { status: 'done', actionId, finalLabels };
  }
  const reason = finalLabels ? 'labels read back did not match the change' : 'message disappeared during the change';
  finishAction(deps.db, actionId, 'failed', finalLabels, reason, clock(deps));
  return { status: 'failed', actionId, reason };
}

/**
 * Settle actions whose outcome was never confirmed (a crash or a provider error mid-change) by reading
 * the mailbox. A label change on one message is atomic, so it either fully applied or did not happen.
 * Never replays the change. Returns how many actions were settled.
 */
export async function reconcile(deps: ActionDeps, scope?: { accountId: string; messageId: string }): Promise<number> {
  let settled = 0;
  for (const action of listOpenActions(deps.db, scope)) {
    const labels = await deps.mailbox.getLabelIds(action.messageId);
    if (labels === null) finishAction(deps.db, action.id, 'failed', null, 'message no longer exists', clock(deps));
    else if (applied(labels, action.payload)) finishAction(deps.db, action.id, 'done', labels, null, clock(deps));
    else finishAction(deps.db, action.id, 'failed', labels, action.error ?? 'change was not applied', clock(deps));
    settled++;
  }
  return settled;
}

/**
 * Apply one triage action to one message. Only messages currently in the inbox are changed.
 * Pass `decisionId` when the action carries out a recorded decision, so the two are linked in the audit log.
 */
export async function execute(deps: ActionDeps, accountId: string, messageId: string, action: MessageAction, decisionId?: number): Promise<Outcome> {
  await reconcile(deps, { accountId, messageId });

  const current = await deps.mailbox.getLabelIds(messageId);
  if (current === null) return { status: 'skipped', reason: 'message no longer exists' };
  if (!current.includes('INBOX')) return { status: 'skipped', reason: 'message is not in the inbox' };

  if (action.type === 'spam') {
    const refusal = await spamRefusal(deps, accountId, messageId);
    if (refusal) return { status: 'skipped', reason: refusal };
  }
  const names = [...(action.labels ?? []), ...(action.type === 'label' ? [] : [AUDIT_LABELS[action.type]])];
  const add: string[] = [];
  for (const name of new Set(names)) add.push(await deps.mailbox.ensureLabel(name));
  const read = action.markRead && action.type !== 'spam' ? ['UNREAD'] : [];
  const change: LabelChange =
    action.type === 'label' ? { add, remove: read } : { add: [...add, ...(action.type === 'spam' ? ['SPAM'] : [])], remove: ['INBOX', ...read] };

  return applyChange(deps, { accountId, messageId, type: action.type, ...(decisionId === undefined ? {} : { decisionId }) }, current, change);
}

/** Spam is the costliest mistake, so every doubt refuses: unknown sender, failed lookup, or any prior correspondence. */
async function spamRefusal(deps: ActionDeps, accountId: string, messageId: string): Promise<string | null> {
  const row = deps.db.prepare('SELECT from_address FROM messages WHERE account_id = ? AND id = ?').get(accountId, messageId) as
    | { from_address: string }
    | undefined;
  if (!row) return 'sender is unknown, so spam is refused';
  try {
    if (await deps.mailbox.hasSentTo(row.from_address)) return 'you have written to this sender, so spam is refused';
  } catch (error) {
    return `could not check correspondence with the sender (${message(error)}), so spam is refused`;
  }
  return null;
}

/**
 * Reverse a completed action exactly: remove what it added, restore what it removed. Labels the user
 * has changed since are left as they are. The undo is itself an audited action.
 */
export async function undo(deps: ActionDeps, actionId: number): Promise<Outcome> {
  const action: ActionRecord | null = getAction(deps.db, actionId);
  if (!action) throw new Error(`There is no change #${actionId}.`);
  if (action.type === 'undo') throw new Error(`Change #${actionId} is itself an undo.`);
  if (action.type === 'filter' || action.type === 'unfilter') throw new Error('A Gmail filter is added or taken out from its rule, not undone.');
  if (action.type === 'unsubscribe') throw new Error('An unsubscribe cannot be undone from here. Subscribe again with the sender.');
  if (action.status !== 'done') throw new Error(`Change #${actionId} is ${action.status}; only completed changes can be undone.`);

  const current = await deps.mailbox.getLabelIds(action.messageId);
  if (current === null) throw new Error('The message no longer exists.');
  if (current.includes('TRASH')) throw new Error('The message is in the trash; restore it in Gmail first.');

  const outcome = await applyChange(deps, { accountId: action.accountId, messageId: action.messageId, type: 'undo', undoOf: action.id }, current, {
    add: action.payload.remove,
    remove: action.payload.add,
  });
  // 'skipped' means the user already put everything back by hand.
  if (outcome.status === 'done' || outcome.status === 'skipped') setActionStatus(deps.db, action.id, 'undone');
  return outcome;
}
