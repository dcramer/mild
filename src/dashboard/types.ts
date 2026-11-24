/**
 * What the dashboard API sends, and the bodies the page sends it, as schemas the server parses them
 * with, a file per area in types/ and what they share in types/parts.ts. The page imports only their types,
 * so zod stays out of it, but the page's type check reads every module they import: keep those to zod and
 * modules that import nothing of the server's (the triage types, src/store/states.ts, src/mail-window.ts,
 * src/model/reasoning.ts).
 *
 * What Mild stores encrypted is `held` (types/parts.ts): a string in the JSON, `Confidential` to the type
 * checker (src/confidential.ts), so the page draws it only through `reveal`, in the browser.
 */
export { FACT_FILTERS, FACT_FILTER_KEYS, Given, RuleFacts, Saved, decided, labelId, text } from './types/parts.ts';
export type { Contact, FactFilter, RuleMatch, StageKey } from './types/parts.ts';
export * from './types/activity.ts';
export * from './types/messages.ts';
export * from './types/senders.ts';
export * from './types/rules.ts';
export * from './types/suggestions.ts';
export * from './types/compose.ts';
export * from './types/labels.ts';
export * from './types/mail.ts';
export * from './types/settings.ts';
export * from './types/evals.ts';
