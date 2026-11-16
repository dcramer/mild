import { preferences as preferenceRows } from './query.ts';
import type { Sql } from './sql.ts';

export interface Preferences {
  /** `provider/model-id`, or null for no model: mail no rule covers is then left for them. */
  model: string | null;
}

export async function preferences(db: Sql): Promise<Preferences> {
  const [row] = await db.select({ model: preferenceRows.model }).from(preferenceRows);
  return { model: row!.model };
}

export async function setModel(db: Sql, model: string | null): Promise<void> {
  await db.update(preferenceRows).set({ model });
}
