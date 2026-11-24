import type { Api, Model, Models, Tool } from '@earendil-works/pi-ai';
import { BY, FACT_WORDS, FILL_TOOL, RULE_DRAFT_PROMPT, type RuleDrafter, buildRuleDraftPrompt, readRuleDraft } from '../prompts/rule-draft.ts';
import { DECIDED } from '../triage/types.ts';
import { withLookups } from './lookups.ts';
import type { Reasoning } from './reasoning.ts';

function fill(labels: readonly string[]): Tool {
  return {
    name: FILL_TOOL,
    description: 'Fill in the rule.',
    parameters: {
      type: 'object',
      // Written first, as the judge's reason is, so the rest follows from it rather than being worked out after.
      properties: {
        reading: {
          type: 'string',
          description:
            'A sentence: which mail they mean, and whether it gets one of their labels, an action alone, or an action once a model gives it a label.',
        },
        conditions: {
          type: 'array',
          description: 'Which mail. Several of one kind are alternatives; different kinds must all hold.',
          items: {
            type: 'object',
            properties: {
              by: {
                type: 'string',
                enum: [...BY],
                description: '`from` takes an address or a domain. A name (exactly, or containing these words) only beside a `from`.',
              },
              value: { type: 'string' },
            },
            required: ['by', 'value'],
            additionalProperties: false,
          },
        },
        facts: { type: 'array', items: { type: 'string', enum: FACT_WORDS } },
        name: { type: 'string', description: 'A few words, only for a rule with several values or kinds of condition; empty otherwise.' },
        label: { type: 'string', enum: ['', ...labels], description: 'One of their labels, or empty.' },
        onlyOnceLabelled: { type: 'boolean', description: 'Wait for a model to give the mail this label, then do `action` instead of what the label does.' },
        when: { type: 'string', description: 'A condition in the owner’s words, beside a label.' },
        action: { type: 'string', enum: ['', ...DECIDED], description: 'Needed with no label, or when it waits for one; empty beside a label that decides.' },
        markRead: { type: 'boolean' },
        unsubscribe: { type: 'boolean' },
        note: { type: 'string', description: 'What else they need, or what a rule cannot do; empty if nothing.' },
      },
      required: ['reading', 'conditions', 'facts', 'name', 'label', 'onlyOnceLabelled', 'when', 'action', 'markRead', 'unsubscribe', 'note'],
      additionalProperties: false,
    },
    constrainedSampling: { type: 'json_schema', strict: 'prefer' },
  };
}

/** A RuleDrafter backed by a pi-ai model: the person's words and labels, with the look-up of their senders. */
export function createRuleDrafter(models: Models, model: Model<Api>, reasoning: Reasoning): RuleDrafter {
  return async (input, findSenders) => {
    const drafted = await withLookups(models, model, reasoning, {
      systemPrompt: RULE_DRAFT_PROMPT,
      prompt: buildRuleDraftPrompt(input),
      record: fill(input.labels.map((l) => l.name)),
      read: (args) => {
        const read = readRuleDraft(args, input.labels);
        return 'draft' in read ? { answer: read.draft } : read;
      },
      findSenders,
      words: {
        unusable: (why) => `the model did not fill in a usable rule: ${why}`,
        retry: (why) => `That rule cannot be used: ${why}. Fill it in again.`,
        noAnswer: 'the model did not fill in a rule',
        nudge: `Fill in the rule with ${FILL_TOOL}.`,
        noMoreLookups: 'No more look-ups: fill in the rule.',
      },
    });
    if (!('answer' in drafted)) return drafted;
    const { answer, ...spent } = drafted;
    return { draft: answer, ...spent };
  };
}
