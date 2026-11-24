/**
 * The states stored rows can be in that the dashboard's API reports as they are. Kept apart from the schema and
 * importing nothing, so src/dashboard/types.ts takes them without bringing the database into the page's types.
 */

/** `changed`: edited in Gmail. `gone`: deleted there. `outdated`: the rule no longer says what the filter does. */
export const FILTER_STATES = ['active', 'changed', 'gone', 'outdated'] as const;
export const EXAMPLE_STATUSES = ['pending', 'captured', 'gone'] as const;
export const EVAL_STATUSES = ['running', 'done', 'failed'] as const;

/**
 * How the owner and a sender know each other, from the mail alone: their first message, someone the owner
 * writes to, or someone who keeps writing and has never been written back to.
 */
export const CONTACTS = ['new', 'mutual', 'one-way'] as const;

/** How far one press of going through the inbox reaches: `REACH` in src/store/inbox-runs.ts. */
export const REACHES = ['inbox', 'recent'] as const;
