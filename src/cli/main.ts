#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { loadConfig, loadEnvFiles, resolveHome } from '../config.ts';
import { closeTerminal } from './terminal.ts';
import { paint, ui } from './ui.ts';
import { dashboard } from './commands/dashboard.ts';
import { dev } from './commands/dev.ts';
import { init } from './commands/init.ts';
import { resetDb } from './commands/reset-db.ts';
import { run } from './commands/run.ts';
import { status } from './commands/status.ts';

/** sift is set up and started from here; looking at and steering it happens in the dashboard. */
const MAIN_COMMANDS: readonly (readonly [string, string])[] = [
  ['init', 'Set sift up, or finish setting it up'],
  ['run', 'Read and classify your mail continuously, and serve the dashboard'],
  ['status', 'What is set up and how much sift has recorded'],
];

const OTHER_COMMANDS: readonly (readonly [string, string])[] = [
  ['dashboard', 'serve the dashboard without reading mail'],
  ['dev', 'for working on sift: run, restarting and reloading as the code changes'],
  ['reset-db', 'move the database aside, so sift starts a new one'],
];

function help(): void {
  ui.heading('helps you manage your Gmail inbox');
  const width = Math.max(...[...MAIN_COMMANDS, ...OTHER_COMMANDS].map(([name]) => name.length));
  for (const [name, what] of MAIN_COMMANDS) ui.plain(`${paint.cmd(`sift ${name.padEnd(width)}`)}  ${what}`);
  ui.blank();
  ui.info('Less often');
  for (const [name, what] of OTHER_COMMANDS) ui.plain(paint.dim(`sift ${name.padEnd(width)}  ${what}`));
  ui.blank();
  ui.info(paint.path(loadConfig().home));
  ui.blank();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // --home works before or after the command; it is the same as setting SIFT_HOME.
  const homeAt = argv.indexOf('--home');
  if (homeAt !== -1) {
    const [, home] = argv.splice(homeAt, 2);
    if (!home) throw new Error('--home needs a directory.');
    process.env['SIFT_HOME'] = home;
  }
  loadEnvFiles(resolveHome());
  const [command, ...args] = argv;
  if (command === 'status') await status();
  else if (command === 'init') await init();
  else if (command === 'dashboard') await dashboard(args);
  else if (command === 'run') await run(args);
  else if (command === 'dev') await dev(args);
  else if (command === 'reset-db') resetDb();
  else if (command === undefined || command === 'help' || command === '--help' || command === '-h') help();
  else {
    ui.fail(`There is no ${paint.cmd(`sift ${command}`)} command. ${paint.cmd('sift help')} lists them.`);
    process.exitCode = 2;
  }
}

try {
  await main();
} catch (error) {
  // A driver's error (Drizzle's "Failed query") says what failed only in its cause.
  ui.fail(error instanceof Error ? (error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message) : String(error));
  process.exitCode = 1;
} finally {
  closeTerminal();
}
