import * as accounts from './accounts.ts';
import * as activity from './activity.ts';
import * as evals from './evals.ts';
import * as examples from './examples.ts';
import * as labels from './labels.ts';
import type { Frame, Read, Write } from './route.ts';
import * as rules from './rules.ts';
import * as senders from './senders.ts';
import * as settings from './settings.ts';
import * as suggestions from './suggestions.ts';

/** Every route under `/api/`, one module per resource. The server applies the session, the scope and the write checks to all of them. */
export const READS: readonly Read[] = [activity, evals, examples, rules, senders, settings, suggestions].flatMap((module) => module.reads);
export const WRITES: readonly Write[] = [accounts, activity, evals, examples, labels, rules, senders, settings, suggestions].flatMap((module) => module.writes);
export const FRAMES: readonly Frame[] = activity.frames;
