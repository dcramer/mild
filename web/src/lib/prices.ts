import type { ManageState } from './api/endpoints.ts';
import { money, plural } from './format.ts';

/**
 * What Mild's sums of money say. Through a subscription (ChatGPT) the plan is not charged by the message, so a
 * sum is only what the same use would cost through the API (pi-ai records each call at that price), and says so.
 */

type Choice = ManageState['model']['choices'][number];

/**
 * The way in to the model in use when it is a subscription (ChatGPT), whose plan is not charged by the message:
 * a price through it is only what the same use would cost through the API, and is said to be.
 */
export function subscription(model: Pick<ManageState['model'], 'choices' | 'chosen'>): Choice | null {
  const provider = model.chosen?.split('/')[0];
  return model.choices.find((c) => c.provider === provider && c.how !== 'key') ?? null;
}

/** Said after a price through a subscription. */
export const AT_API_PRICES = 'at API prices';
/** Said of a price through a subscription, once in each place one is shown: the person does not pay it. */
const covers = (plan: Choice) => `which your ${plan.label} plan covers`;

/** A sum spent or to spend, and through a subscription that it is an API price the plan covers, said once wherever sums are shown together. */
export const atApiPrices = (plan: Choice) => `At API prices, ${covers(plan)}.`;

/** What classifying with a model costs, about so much per 1,000 messages. Null when the catalog has no price. */
export function costLine(choice: Choice | undefined, costs: Record<string, number>, model: string): string | null {
  const cost = costs[model];
  if (cost === undefined) return null;
  if (choice && choice.how !== 'key') return `About ${money(cost)} per 1,000 messages ${AT_API_PRICES}, ${covers(choice)}.`;
  return `About ${money(cost)} per 1,000 messages.`;
}

/** What going through so many messages would cost, as the inbox's row says it. */
export function costOfMessages(usd: number, subscribed: Choice | null): string {
  return subscribed ? `About ${money(usd)} ${AT_API_PRICES}, ${covers(subscribed)}.` : `Going through them costs about ${money(usd)}.`;
}

/** What the model cost over the last 30 days, for so many messages, as Settings says it. */
export function spentLine(usd: number, messages: number, subscribed: Choice | null): string {
  return subscribed
    ? `${money(usd)} ${AT_API_PRICES} in the last 30 days, for ${plural(messages, 'message')}, ${covers(subscribed)}.`
    : `${money(usd)} in the last 30 days, for ${plural(messages, 'message')}.`;
}

/** Under a price figure: the model it is for and, through a subscription, that it is an API price. */
export function priceNote(model: string | null, subscribed: Choice | null): string | null {
  const on = model ? `on ${model.slice(model.indexOf('/') + 1)}` : null;
  return subscribed ? [on, AT_API_PRICES].filter(Boolean).join(', ') : on;
}

/** A sum through a plan, marked as only about what the API would have charged; `atApiPrices` says why where it is shown. */
export const approx = (usd: number, plan: Choice | null) => (plan ? `≈${money(usd)}` : money(usd));

/** A chart's line of what the model cost, named for what its sums are. */
export const costName = (plan: Choice | null) => (plan ? 'Model cost at API prices' : 'Model cost');

/** The way in a call on `model` (`provider/model-id`) went through, when it was a subscription. */
export const planOf = (model: string, choices: ManageState['model']['choices']): Choice | null =>
  choices.find((c) => model.startsWith(`${c.provider}/`) && c.how !== 'key') ?? null;
