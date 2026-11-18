import { isNull, preferences as preferenceRows } from './query.ts';
import type { Sql } from './sql.ts';

export interface Preferences {
  /** Whether sift is on for them. Off: what sift decides for their mail stays a suggestion. On: it is carried out in Gmail. */
  active: boolean;
  /** `provider/model-id`, or null for no model: mail no rule covers is then left for them. */
  model: string | null;
  /** The hour of their day, 0 to 23, a label's digest arrives. */
  digestHour: number;
  /** Their IANA time zone, as their browser last said it; null when it never has, which is read as UTC. */
  timeZone: string | null;
}

export async function preferences(db: Sql): Promise<Preferences> {
  const [row] = await db
    .select({ active: preferenceRows.active, model: preferenceRows.model, digestHour: preferenceRows.digestHour, timeZone: preferenceRows.timeZone })
    .from(preferenceRows);
  return { active: row!.active, model: row!.model, digestHour: row!.digestHour, timeZone: row!.timeZone };
}

export async function setActive(db: Sql, active: boolean): Promise<void> {
  await db.update(preferenceRows).set({ active });
}

export async function setModel(db: Sql, model: string | null): Promise<void> {
  await db.update(preferenceRows).set({ model });
}

export async function setDigestTime(db: Sql, hour: number, timeZone: string): Promise<void> {
  await db.update(preferenceRows).set({ digestHour: hour, timeZone });
}

/** The zone a browser said, kept only when none is: a label set to Digest from another device does not move the digest's hour. */
export async function rememberTimeZone(db: Sql, timeZone: string): Promise<void> {
  await db.update(preferenceRows).set({ timeZone }).where(isNull(preferenceRows.timeZone));
}
