import { existsSync, renameSync } from 'node:fs';
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
  // Workflow's runs name the old database's people and mailboxes by id; taken up over a new one, they would do another's work.
  if (existsSync(config.workflowDir)) {
    const runs = `${config.workflowDir}${to.slice(config.databaseDir.length)}`;
    renameSync(config.workflowDir, runs);
    ui.ok(`Moved the work under way to ${paint.path(runs)}.`);
  }
}
