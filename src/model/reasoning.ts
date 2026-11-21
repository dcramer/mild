/**
 * How hard the model thinks before it answers, as the person chooses it. pi-ai turns reasoning off when it is
 * given none, and a misjudged share from a colleague was judged that way, so the least Mild asks for is low. A
 * model that cannot do a level is given the nearest it can (pi-ai's `clampThinkingLevel`).
 */
export const REASONING = ['low', 'medium', 'high'] as const;
export type Reasoning = (typeof REASONING)[number];
