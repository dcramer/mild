import { type ACTION_STATUSES, type ACTION_TYPES, actions, and, asc, desc, eq, inArray, isNotNull, max, messages, min, notInArray } from './query.ts';
import type { Sql } from './sql.ts';

export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ActionType = (typeof ACTION_TYPES)[number];

/** The label change an action made (or tried to make), as provider label ids. */
export interface LabelChange {
  add: string[];
  remove: string[];
}

export interface ActionPayload extends LabelChange {
  /** For `undo` actions, the id of the action being reversed. */
  undoOf?: number;
  /** For `unsubscribe` actions, which changes no label: the host the request went to. */
  unsubscribe?: string;
  /** For `filter` and `unfilter` actions, which change no message: the rule, and the Gmail filter written for it or taken out. */
  filter?: { ruleId: string; id?: string; criteria?: Record<string, unknown>; action?: Record<string, unknown> };
}

export interface ActionRecord {
  id: number;
  accountId: string;
  messageId: string;
  type: ActionType;
  payload: ActionPayload;
  originalLabels: string[];
  finalLabels: string[] | null;
  status: ActionStatus;
  error: string | null;
  createdAt: number;
}

const COLUMNS = {
  id: actions.id,
  accountId: actions.accountId,
  messageId: actions.messageId,
  type: actions.type,
  payload: actions.payload,
  originalLabels: actions.originalLabels,
  finalLabels: actions.finalLabels,
  status: actions.status,
  error: actions.error,
  createdAt: actions.createdAt,
};

const fromRow = ({
  messageId,
  originalLabels,
  ...r
}: {
  id: number;
  accountId: string;
  messageId: string | null;
  type: ActionType;
  payload: ActionPayload;
  originalLabels: string[] | null;
  finalLabels: string[] | null;
  status: ActionStatus;
  error: string | null;
  createdAt: number;
}): ActionRecord => ({ ...r, messageId: messageId!, originalLabels: originalLabels! });

/** Write the intent before touching the provider. Returns the action id. */
export async function insertPendingAction(
  db: Sql,
  action: { accountId: string; messageId: string | null; type: ActionType; payload: ActionPayload; originalLabels: string[]; decisionId?: number },
  now: number,
): Promise<number> {
  const [row] = await db
    .insert(actions)
    .values({
      accountId: action.accountId,
      messageId: action.messageId,
      type: action.type,
      payload: action.payload,
      originalLabels: action.originalLabels,
      decisionId: action.decisionId ?? null,
      status: 'pending',
      createdAt: now,
    })
    .returning({ id: actions.id });
  return row!.id;
}

export async function finishAction(db: Sql, id: number, status: ActionStatus, finalLabels: string[] | null, error: string | null, now: number): Promise<void> {
  await db.update(actions).set({ status, finalLabels, error, completedAt: now }).where(eq(actions.id, id));
}

export async function setActionStatus(db: Sql, id: number, status: ActionStatus): Promise<void> {
  await db.update(actions).set({ status }).where(eq(actions.id, id));
}

export async function getAction(db: Sql, id: number): Promise<ActionRecord | null> {
  const [row] = await db.select(COLUMNS).from(actions).where(eq(actions.id, id));
  return row ? fromRow(row) : null;
}

/** The last thing sift did to a message's labels that still stands, or null. */
export async function lastStandingChange(db: Sql, accountId: string, messageId: string): Promise<ActionRecord | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(actions)
    .where(
      and(eq(actions.accountId, accountId), eq(actions.messageId, messageId), notInArray(actions.type, ['undo', 'unsubscribe']), eq(actions.status, 'done')),
    )
    .orderBy(desc(actions.id))
    .limit(1);
  return row ? fromRow(row) : null;
}

/** Actions whose outcome was never confirmed, oldest first. Optionally limited to one message. */
export async function listOpenActions(db: Sql, scope?: { accountId: string; messageId: string }): Promise<ActionRecord[]> {
  const rows = await db
    .select(COLUMNS)
    .from(actions)
    .where(
      and(
        inArray(actions.status, ['pending', 'unknown']),
        isNotNull(actions.messageId),
        scope ? and(eq(actions.accountId, scope.accountId), eq(actions.messageId, scope.messageId)) : undefined,
      ),
    )
    .orderBy(asc(actions.id));
  return rows.map(fromRow);
}

/** When the user unsubscribed from this sender through sift, or null. */
export async function unsubscribedAt(db: Sql, accountId: string, sender: string): Promise<number | null> {
  const [row] = await db
    .select({ at: min(actions.createdAt) })
    .from(actions)
    .innerJoin(messages, and(eq(messages.accountId, actions.accountId), eq(messages.id, actions.messageId)))
    .where(and(eq(actions.accountId, accountId), eq(actions.type, 'unsubscribe'), eq(actions.status, 'done'), eq(messages.fromAddress, sender)));
  return row!.at;
}

/** When an unsubscribe request to this sender last failed, or null. */
export async function lastUnsubscribeFailure(db: Sql, accountId: string, sender: string): Promise<number | null> {
  const [row] = await db
    .select({ at: max(actions.createdAt) })
    .from(actions)
    .innerJoin(messages, and(eq(messages.accountId, actions.accountId), eq(messages.id, actions.messageId)))
    .where(and(eq(actions.accountId, accountId), eq(actions.type, 'unsubscribe'), eq(actions.status, 'failed'), eq(messages.fromAddress, sender)));
  return row!.at;
}
