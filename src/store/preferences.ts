import { isNull, mailBodies, preferences as preferenceRows } from './query.ts';
import type { Reasoning } from '../model/reasoning.ts';
import type { Sql } from './sql.ts';

export interface Preferences {
  /** Whether sift is on for them. Off: what sift decides for their mail stays a suggestion. On: it is carried out in Gmail. */
  active: boolean;
  /** Whether Inbox is on for them: Sift keeps the text of their inbox mail, and may send as them from a mailbox that lets it. */
  mail: boolean;
  /** `provider/model-id`, or null for no model: mail no rule covers is then left for them. */
  model: string | null;
  /** How hard their model thinks before it answers. */
  reasoning: Reasoning;
  /** The hour of their day, 0 to 23, a label's digest arrives. */
  digestHour: number;
  /** Their IANA time zone, as their browser last said it; null when it never has, which is read as UTC. */
  timeZone: string | null;
}

export async function preferences(db: Sql): Promise<Preferences> {
  const [row] = await db
    .select({
      active: preferenceRows.active,
      mail: preferenceRows.mail,
      model: preferenceRows.model,
      reasoning: preferenceRows.reasoning,
      digestHour: preferenceRows.digestHour,
      timeZone: preferenceRows.timeZone,
    })
    .from(preferenceRows);
  return { active: row!.active, mail: row!.mail, model: row!.model, reasoning: row!.reasoning, digestHour: row!.digestHour, timeZone: row!.timeZone };
}

export async function setActive(db: Sql, active: boolean): Promise<void> {
  await db.update(preferenceRows).set({ active });
}

/** Off, the text Sift kept of their inbox mail goes in the same write. */
export async function setMail(db: Sql, on: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(preferenceRows).set({ mail: on });
    if (!on) await tx.delete(mailBodies);
  });
}

export async function setModel(db: Sql, model: string | null): Promise<void> {
  await db.update(preferenceRows).set({ model });
}

export async function setReasoning(db: Sql, reasoning: Reasoning): Promise<void> {
  await db.update(preferenceRows).set({ reasoning });
}

export async function setDigestTime(db: Sql, hour: number, timeZone: string): Promise<void> {
  await db.update(preferenceRows).set({ digestHour: hour, timeZone });
}

/** The zone a browser said, kept only when none is: a label set to Digest from another device does not move the digest's hour. */
export async function rememberTimeZone(db: Sql, timeZone: string): Promise<void> {
  await db.update(preferenceRows).set({ timeZone }).where(isNull(preferenceRows.timeZone));
}
