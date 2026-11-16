import { preferences as preferenceRows } from './query.ts';
import type { Sql } from './sql.ts';

export interface Preferences {
  /** Whether sift is on for them. Off: what sift decides for their mail stays a suggestion. On: it is carried out in Gmail. */
  active: boolean;
  /** `provider/model-id`, or null for no model: mail no rule covers is then left for them. */
  model: string | null;
}

export async function preferences(db: Sql): Promise<Preferences> {
  const [row] = await db.select({ active: preferenceRows.active, model: preferenceRows.model }).from(preferenceRows);
  return { active: row!.active, model: row!.model };
}

export async function setActive(db: Sql, active: boolean): Promise<void> {
  await db.update(preferenceRows).set({ active });
}

export async function setModel(db: Sql, model: string | null): Promise<void> {
  await db.update(preferenceRows).set({ model });
}
