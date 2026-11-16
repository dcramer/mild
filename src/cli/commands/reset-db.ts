import { existsSync } from 'node:fs';
import { loadConfig } from '../../config.ts';
import { moveAside } from '../../store/db.ts';
import { paint, ui } from '../ui.ts';

export function resetDb(): void {
  const config = loadConfig();
  if (config.databaseUrl) throw new Error('Sift is set to use a Postgres server. Drop and create its database there instead.');
  if (!existsSync(config.databaseDir)) {
    ui.skip(`There is no database in ${paint.path(config.home)} yet.`);
    return;
  }
  const to = moveAside(config.databaseDir);
  ui.ok(`Moved the database to ${paint.path(to)}. Sift starts a new one when it next opens it; delete the old one once you no longer need it.`);
}
