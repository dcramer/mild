import type { Api, Model, Models, Tool } from '@earendil-works/pi-ai';
import { ASK_PROMPT, ASK_TOOL, type MailAsker, VIEW_WORDS, buildAskPrompt, readMailFilter } from '../prompts/mail-ask.ts';
import { withLookups } from './lookups.ts';
import type { Reasoning } from './reasoning.ts';

function narrow(labels: readonly string[]): Tool {
  const strings = { type: 'array', items: { type: 'string' } } as const;
  return {
    name: ASK_TOOL,
    description: 'Narrow the list of conversations.',
    parameters: {
      type: 'object',
      // Written first, as the rule drafter's reading is, so the rest follows from it.
      properties: {
        reading: { type: 'string', description: 'A sentence: which conversations they mean.' },
        from: { ...strings, description: 'Addresses a look-up returned.' },
        domains: { ...strings, description: 'Domains of senders a look-up returned, for everyone there.' },
        label: { type: 'string', enum: ['', ...labels] },
        view: { type: 'string', enum: VIEW_WORDS },
        unread: { type: 'boolean' },
        since: { type: 'string', description: 'YYYY-MM-DD, or empty.' },
        words: { ...strings, description: 'Words one message must have, every one, in its text, sender or subject.' },
        note: { type: 'string', description: 'What of what they asked the list cannot narrow by; empty if nothing.' },
      },
      required: ['reading', 'from', 'domains', 'label', 'view', 'unread', 'since', 'words', 'note'],
      additionalProperties: false,
    },
    constrainedSampling: { type: 'json_schema', strict: 'prefer' },
  };
}

/**
 * A MailAsker backed by a pi-ai model: the person's words and labels, with the look-up of their senders. The filter
 * is checked against what the look-ups returned.
 */
export function createMailAsker(models: Models, model: Model<Api>, reasoning: Reasoning): MailAsker {
  return async (input, findSenders) => {
    const asked = await withLookups(models, model, reasoning, {
      systemPrompt: ASK_PROMPT,
      prompt: buildAskPrompt(input),
      record: narrow(input.labels.map((l) => l.name)),
      read: (args, found) => readMailFilter(args, input, found),
      findSenders,
      words: {
        unusable: (why) => `the model did not make a usable filter: ${why}`,
        retry: (why) => `That filter cannot be used: ${why}. Call ${ASK_TOOL} again.`,
        noAnswer: 'the model did not make a filter',
        nudge: `Narrow the list with ${ASK_TOOL}.`,
        noMoreLookups: `No more look-ups: call ${ASK_TOOL}.`,
      },
    });
    if (!('answer' in asked)) return asked;
    const { answer, ...spent } = asked;
    return { ...answer, ...spent };
  };
}
