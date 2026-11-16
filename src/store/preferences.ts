import { preferences as preferenceRows } from './query.ts';
import type { Sql } from './sql.ts';

export interface Preferences {
  /** False: what sift decides for their mail stays a suggestion. True: it is carried out in Gmail. */
  act: boolean;
  /** `provider/model-id`, or null for no model: mail no rule covers is then left for them. */
  model: string | null;
}

export async function preferences(db: Sql): Promise<Preferences> {
  const [row] = await db.select({ act: preferenceRows.act, model: preferenceRows.model }).from(preferenceRows);
  return { act: row!.act, model: row!.model };
}

export async function setAct(db: Sql, act: boolean): Promise<void> {
  await db.update(preferenceRows).set({ act });
}

export async function setModel(db: Sql, model: string | null): Promise<void> {
  await db.update(preferenceRows).set({ model });
}
